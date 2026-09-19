// A 70-second cycle with amber and one second of all-red clearance per transition.
export function signalState(elapsed, green = 35) {
  const phase = ((elapsed % 70) + 70) % 70;
  const stages = [
    [green, 'green', 'red'], [green + 3, 'amber', 'red'],
    [green + 4, 'red', 'red'], [66, 'red', 'green'],
    [69, 'red', 'amber'], [70, 'red', 'red'],
  ];
  const [end, penn, cross] = stages.find(([end]) => phase < end);
  return { penn, cross, remaining: Math.ceil(end - phase), phase };
}
