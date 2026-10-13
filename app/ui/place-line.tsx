import { routeUrl, type PlaceFields } from '../lib/planning/places'

/** Ort eines Punkts fürs Team, mit Adresse und "Route öffnen", wenn es den Ort mit Adresse gibt (Idee L22). */
export default function PlaceLine({ location, place }: { location: string; place: PlaceFields | null }) {
  return (
    <p className="text-sm text-gray-700 dark:text-gray-300">
      {location}
      {place && (
        <>
          {' · '}{place.address}{' · '}
          <a href={routeUrl(place)} target="_blank" rel="noopener noreferrer" className="text-blue-700 dark:text-blue-300 hover:underline print:hidden">Route</a>
        </>
      )}
    </p>
  )
}
