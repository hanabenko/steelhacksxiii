"""Check live provider wiring without printing credentials or saving audio.

Run with --live to make one small Gemini and ElevenLabs request (uses API quota).
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gemini.app.config import load_settings as gemini_settings
from gemini.app.client import GeminiClient
from gemini.app.generation import get_task
from voice.app.config import load_settings as voice_settings
from voice.app.elevenlabs import ElevenLabsClient


async def check(live, voices=False, provider='both', round_trip=False):
    g, v = gemini_settings(), voice_settings()
    report = {'gemini_configured': g.has_key, 'voice_configured': v.has_key}
    if voices:
        client = ElevenLabsClient(v)
        try:
            report['voices'] = await client.list_voices()
        finally:
            await client.aclose()
    if live:
        if g.generation_enabled and provider != 'voice':
            client = GeminiClient(g)
            try:
                task = get_task('simulation_debrief')
                response = await client.generate_json(prompt=task.build_prompt({}), schema=task.schema,
                                                      system_instruction=task.system_instruction)
                report['gemini_live'] = bool(response.get('verdict'))
            except Exception as exc:
                report['gemini_live_error'] = type(exc).__name__
                report['gemini_status'] = getattr(exc, 'status_code', None)
                report['gemini_detail'] = str(exc).replace(g.api_key or '__absent__', '[redacted]')[:500]
            finally:
                await client.aclose()
        if v.audio_enabled and provider != 'gemini':
            client = ElevenLabsClient(v)
            try:
                audio = await client.text_to_speech('Simulation ready.')
                report['voice_audio_bytes'] = len(audio)
                if round_trip:
                    report['transcript'] = await client.speech_to_text(audio, 'smoke.mp3', 'audio/mpeg')
            except Exception as exc:
                report['voice_live_error'] = type(exc).__name__
                report['voice_status'] = getattr(exc, 'status_code', None)
                report['voice_detail'] = str(exc).replace(v.api_key or '__absent__', '[redacted]')[:500]
            finally:
                await client.aclose()
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--voices', action='store_true')
    parser.add_argument('--provider', choices=['both', 'gemini', 'voice'], default='both')
    parser.add_argument('--round-trip', action='store_true')
    args = parser.parse_args()
    asyncio.run(check(args.live, args.voices, args.provider, args.round_trip))
