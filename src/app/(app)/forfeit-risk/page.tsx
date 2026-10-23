import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam, resolveScope } from "@/lib/seasons";
import { getLocationDistricts } from "@/lib/districts-locations";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { TableSkeleton } from "../dashboard/Skeletons";
import ForfeitRisk from "./ForfeitRisk";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Forfeit risk tab: every team one no-show from forfeiting, from the overdue
// app's Teams board, with the same Season / Location / District filters as the
// Ambassador teams page it used to sit at the bottom of.
export default async function ForfeitRiskPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; district?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam, district: districtParam } = await searchParams;
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const selectedDistricts = csvParam(districtParam);

  // Forfeits happen in games being played, so this opens on the season in play.
  const [scope, districtMap] = await Promise.all([
    resolveScope({ season: selectedSeasons[0], locations: selectedLocations }, { defaultSeason: "playing" }),
    getLocationDistricts(),
  ]);
  const { filterLocations, promoSeasons, selectedSeason } = scope;
  // The district filter narrows the location filter, by the districts app's
  // own assignment. An empty list means nothing matches.
  const locationNames = selectedDistricts.length && districtMap
    ? (scope.locationNames ?? scope.promoLocations).filter((n) => {
        const d = districtMap.byLocation.get(n);
        return !!d && selectedDistricts.includes(d);
      })
    : scope.locationNames;

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: filterLocations,
    districts: districtMap?.districts,
  };

  return (
    <main className="brodie-fade-in space-y-8">
      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}|${selectedDistricts.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
          districts: selectedDistricts,
        }}
      />

      {/* Streams in: the overdue app checks every location's rosters to answer. */}
      <Suspense fallback={<TableSkeleton title="Forfeit risk" rows={5} />}>
        <ForfeitRisk season={selectedSeason} locationNames={locationNames} />
      </Suspense>
    </main>
  );
}
