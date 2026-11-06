import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam, resolveScope } from "@/lib/seasons";
import { getLocationDistricts } from "@/lib/districts-locations";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { BasisToggle } from "../dashboard/BasisToggle";
import { TableSkeleton } from "../dashboard/Skeletons";
import RetentionView, { METRICS, type Metric, type Sort } from "./RetentionView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Retention: every location ranked on one of four measures, who had played
// Brodie before (ever, or within the last year) and who came back (captains,
// athletes), with the same Season / Location / District filters as the other
// registration pages.
export default async function RetentionPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; district?: string; metric?: string; sort?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam, district: districtParam, metric: metricParam, sort: sortParam } = await searchParams;
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const selectedDistricts = csvParam(districtParam);
  const metric: Metric = METRICS.find((m) => m.value === metricParam)?.value ?? "before";
  const sort: Sort = sortParam === "name" ? "name" : "size";

  // Retention is about who registered, so it opens on the season being sold.
  const [scope, districtMap] = await Promise.all([
    resolveScope({ season: selectedSeasons[0], locations: selectedLocations }, { defaultSeason: "registration" }),
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
    <main className="brodie-fade-in space-y-6">
      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}|${selectedDistricts.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
          districts: selectedDistricts,
        }}
        keep={{ ...(metric !== "before" ? { metric } : {}), ...(sort !== "size" ? { sort } : {}) }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BasisToggle param="metric" value={metric} options={METRICS} />
        <BasisToggle param="sort" value={sort}
          options={[{ value: "size", label: "Largest first" }, { value: "name", label: "A to Z" }]} />
      </div>
      <Suspense key={`${selectedSeason}|${metric}|${sort}|${(locationNames ?? []).join(",")}`}
        fallback={<TableSkeleton title={METRICS.find((m) => m.value === metric)!.label} rows={8} />}>
        <RetentionView season={selectedSeason} locationNames={locationNames} metric={metric} sort={sort} />
      </Suspense>
    </main>
  );
}
