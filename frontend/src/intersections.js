// OSM intersection nodes projected into the checked-in campus map's meter coordinates.
export const INTERSECTIONS = [
  {
    "id": "pitt-forbes-bigelow",
    "name": "Forbes × Bigelow",
    "primaryRoad": "Forbes Avenue",
    "crossRoad": "Bigelow Boulevard",
    "origin": [
      0,
      0
    ],
    "lat": 40.4431909,
    "lon": -79.9535474,
    "sourceUrl": "https://www.openstreetmap.org/node/105013345"
  },
  {
    "id": "pitt-fifth-bigelow",
    "name": "Fifth × Bigelow",
    "primaryRoad": "Fifth Avenue",
    "crossRoad": "Bigelow Boulevard",
    "origin": [
      -24.6,
      -170.48
    ],
    "lat": 40.4444185,
    "lon": -79.954785,
    "sourceUrl": "https://www.openstreetmap.org/node/105097584"
  },
  {
    "id": "pitt-forbes-bouquet",
    "name": "Forbes × Bouquet",
    "primaryRoad": "Forbes Avenue",
    "crossRoad": "South Bouquet Street",
    "origin": [
      -280.56,
      0
    ],
    "lat": 40.4419581,
    "lon": -79.9564358,
    "sourceUrl": "https://www.openstreetmap.org/node/105013320"
  }
];
export const DEFAULT_INTERSECTION = INTERSECTIONS[0].id;
export const intersectionById = id => INTERSECTIONS.find(site=>site.id===(id||DEFAULT_INTERSECTION));
