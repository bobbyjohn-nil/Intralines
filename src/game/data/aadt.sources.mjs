// The AADT services, in plain JS so the Node bake script and the browser
// loader read from exactly one list. Both call these the same way: an ArcGIS
// REST feature layer queried by bounding box for an average-daily-traffic
// field.

export const AADT_SOURCES = [
  {
    // FHWA HPMS — national coverage of the federal-aid network
    name: 'FHWA HPMS',
    url: 'https://geo.dot.gov/server/rest/services/Hosted/HPMS_FULL_AADT/FeatureServer/0',
    field: 'aadt',
  },
  {
    // BTS National Transportation Atlas mirror of the same programme
    name: 'BTS NTAD',
    url: 'https://geo.dot.gov/server/rest/services/NTAD/HPMS/MapServer/0',
    field: 'AADT',
  },
];
