import {
  buildableShips,
  canEmbarkFrom,
  fleetCapacity,
  hasWarship,
  shipById,
  transportsIn,
  type UnitStack,
} from '../data/units';
import type { World } from '../data/world';
import { armiesOf, stackSize } from './armies';
import { TICKS_PER_MONTH } from './calendar';
import { canAfford, queueShip } from './construction';
import {
  berths,
  disembark,
  embark,
  fitting,
  fleetAt,
  fleetsOf,
  isCoastal,
  isWater,
  landingSites,
  launch,
  mergeFleets,
  seaNeighbours,
  seaBeside,
} from './fleets';
import { landmassOf, reachedIn, sailingDistanceFrom, UNREACHABLE } from './geography';
import { orderMove } from './movement';
import { findSeaPath, orderSail, stormBeach } from './sailing';
import {
  MAX_ARMY_UNITS,
  MAX_FLEET_SHIPS,
  MAX_FLEET_TRANSPORTS,
  type ArmyState,
  type CityState,
  type FleetState,
  type SimState,
} from './types';

/**
 * How a rival realm crosses water — docs/MECHANICS.md §10.
 *
 * This is why the naval phase exists. Until 0.18.0 every acre a realm could **march** to got
 * claimed and everything else sat out the campaign: a dozen independent cities in Scandinavia,
 * Ireland, Cyprus and North Africa survived every century because no realm could reach them, and
 * Iberia and Britain could not touch each other. The land AI was not wrong to ignore them — there
 * genuinely was no route (docs/DESIGN.md decision 119). Now there is.
 *
 * The whole behaviour is one **expedition at a time, per realm**, and that limit is deliberate. A
 * realm that runs three amphibious operations at once splits an army it could barely spare into
 * three that each land and die, and the map fills with drowned invasions. One target, one fleet,
 * one landing — and once a beachhead is ashore, the ordinary land AI takes over, because a landed
 * army makes the realm's own frontier on that coast (see `runAi`).
 *
 * Everything here goes through the same functions the player's UI calls — `queueShip`, `launch`,
 * `embark`, `orderSail`, `disembark` (decision 86). There is no back door to the sea either.
 */

/**
 * Escorts a realm wants before it will risk an army at sea, and the hulls it will build in all.
 *
 * **Both scale with the realm**, since 0.18.2. They were flat — one escort, eight hulls, for every
 * realm from a village to an empire — and the consequence was measurable and exactly what the owner
 * saw: at 120 years there were **eight fleets in the whole world**, and the Turks, holding 22 cities
 * and 74 armies, had **one**. A realm that owns half the Mediterranean coast should not have the
 * navy of a realm that owns a fishing village.
 *
 * Both are now **floors under a demand figure** rather than the whole answer — see `convoysWanted`
 * and `navalAppetite`. What a realm holds says how big a navy it can keep; what it has standing
 * about with nothing to do says how big a one it actually needs. **[GEN]**
 */
export function escortsWanted(cities: number, landlocked: boolean, convoys: number): number {
  /**
   * **Three warships to a convoy, and a squadron over the top of that** — owner-specified in
   * 0.19.1: *"a fleet that transports units should have large amounts of warships to protect them,
   * both in the same fleet or in the fleet clearing the way for them."*
   *
   * One per convoy was the old floor and it was only ever the bare cargo rule (decision 126): enough
   * that a hold is not naked, nowhere near enough to *win* the fight it gets into. Three is a
   * squadron, and a convoy's fleet has sixteen berths spare beside its four Transports, so they ride
   * with the cargo where they can and sail as a covering fleet where they cannot.
   *
   * Raising this number was the exact thing that destroyed overseas conquest in 0.18.9, and the
   * reason it is safe now is not this function — it is `buildFleet`, which since 0.19.1 measures the
   * escort against the **hold already afloat** rather than the hold eventually wanted. A big target
   * here no longer means decades of warships before the first transport.
   */
  const perConvoy = convoys * ESCORTS_PER_CONVOY;
  const patrol = 1 + Math.floor(cities / 4) + (landlocked ? 3 : 0);
  return Math.min(ESCORT_CAP, Math.max(patrol, perConvoy));
}

/** Warships a realm wants for every convoy it means to run. **[GEN]** */
export const ESCORTS_PER_CONVOY = 3;

/**
 * The most escorts a realm's navy will run to. **[GEN]**
 *
 * Raised from 14 to 40 in 0.19.1 with the rest of the owner's naval brief. Fourteen was a ceiling
 * set when a realm ran at most five convoys and one escort each; at three apiece and twelve convoys
 * it would bind long before the plan was built.
 */
const ESCORT_CAP = 40;

export function hullsWanted(
  cities: number,
  landlocked: boolean,
  convoys: number,
  escorts: number,
): number {
  // Raised again in 0.18.6: at 60 a 56-city empire with 31 harbours had **no shipyard queue busy
  // anywhere**, which is the same wall 0.18.5 knocked down one notch lower.
  //
  // And it is now never allowed to sit below the plan it is capping. A realm that has decided it
  // wants five convoys and eight escorts needs 28 hulls to have them; a ceiling of 24 means it
  // stops building at 24 and never assembles the thing it decided on — the same wall as before,
  // one level up. The realm's own size still sets the ceiling whenever the ceiling is the larger.
  const bySize = 12 + cities * 2 + (landlocked ? 20 : 0);
  return Math.min(140, Math.max(bySize, MAX_FLEET_TRANSPORTS * convoys + escorts));
}

/**
 * Whole armies a realm wants to be able to lift at once, and therefore the berths it builds for.
 *
 * **This is the formula NEXT.md §2 said was the wrong shape, and this is the different shape.**
 *
 * It used to be a function of **cities held** alone, and the previous session proved that raising
 * that could not deliver the ships the owner asked for. Every attempt destroyed overseas conquest
 * outright — hulls 300 and escorts 24 took **0** of the 7 marooned settlements against the shipped
 * build's 5–7 — for two mechanical reasons that no constant can dodge. Escorts are built before
 * transports, so a bigger escort target starves the hold for decades; and a crew and a spearman come
 * out of the same fifth of a realm's people (decision 127), so a realm that pours a third of its
 * population into hulls fields a smaller army and past a point the boats stop paying for themselves.
 *
 * The observation that fixes it: **both of those costs are only costs to a realm that still has a
 * land war.** A realm with forty stacks walking in circles round Iberia because everything left is
 * across the water is not short of soldiers — it is short of *shipping*, and every man it puts in a
 * crew is a man who was doing nothing. So the demand signal is not what a realm owns, it is what it
 * has spare: `spareLift` counts the units in field and raiding stacks that have no war they can
 * march to, in whole armies' worth.
 *
 * Kept as a **floor, not a replacement**. The city figure is what the shipped build measurably
 * conquers with, and a realm mid-war on its own continent gets exactly what it got before; only a
 * realm with idle armies is given more. That is what makes this safe to raise where the flat
 * attempts were not — the realms it raises are by definition the ones with people to spare.
 */
export function convoysWanted(cities: number, spareLift: number): number {
  // The size figure keeps **its own** old cap of five, not the new one. Letting it run up to
  // `MAX_CONVOYS` would quietly hand every large realm three more convoys whether or not it had a
  // man to spare, which is the flat raise that measurably destroyed overseas conquest last time.
  // Only idle troops may push a realm past five.
  const bySize = Math.min(CONVOYS_BY_SIZE, 1 + Math.floor(cities / 10));
  return Math.max(1, Math.min(MAX_CONVOYS, Math.max(bySize, spareLift)));
}

/** The most convoys a realm's **size** alone will buy it — the shipped 0.18.5 figure, untouched. */
const CONVOYS_BY_SIZE = 5;

/**
 * The most armies a realm will build shipping for at once. **[GEN]**
 *
 * Eight. Two things bound it from above and neither is the treasury: a realm lands on at most four
 * beaches (`MAX_BEACHES`), so eight convoys is two waves onto each, and a convoy is four Transports
 * of forty crew — eight of them is 1,280 men, which is a real bite out of a fifth of a realm even
 * when the realm has nothing else to spend it on.
 *
 * **Twelve since 0.19.1**, up from eight — owner-specified, *"a large faction should be able to make
 * more landings and have more naval dominance than current situation."* It is the companion to
 * `maxBeaches`: seven coasts to land on is worth little if a realm can only fill eight holds, and
 * twelve convoys against seven beaches is very nearly a second wave everywhere at once.
 *
 * Only realms with idle armies ever reach it — `convoysWanted` takes the larger of this demand and
 * the realm's size, and size alone still stops at five (`CONVOYS_BY_SIZE`). A realm still fighting
 * on land is untouched by the raise.
 */
export const MAX_CONVOYS = 12;

/**
 * How often a realm re-plans its expedition, in months. **[GEN]**
 *
 * Twelve, and staggered by faction index. An amphibious operation takes years — the transports
 * alone are six months on the slipway — so a realm that reconsiders monthly is not deciding more
 * finely, it is deciding the same thing twelve times.
 *
 * Only the **map sweeps that pick a target** are on this cadence. Landing, loading and launching
 * are local decisions and happen the month they become possible; putting them here was measured
 * leaving a two-unit army standing on a quay beside eight free berths for want of the right month.
 *
 * Four was tried and changed nothing — the same one marooned city fell in 120 years — while
 * tripling the sweep cost. Whatever limits how often a realm invades, it is not this.
 */
const PLANNING_MONTHS = 12;

/**
 * Berths a realm wants before it stops building transports and starts building an escort.
 *
 * **Twenty — a whole army, in four Transports** (owner-specified in 0.18.1: five units a hull).
 * The old figure was eight, from when a Transport carried two, and it was chosen because an army
 * could not be split: a fleet that could not take a whole stack took nothing at all.
 *
 * Splitting exists now (`fitting`, decision 129), so a short fleet is no longer a useless one —
 * but a realm still *wants* the whole army across, because a landing force that arrives in halves
 * arrives in a country that will kill each half separately.
 */
const BERTHS_WANTED = MAX_ARMY_UNITS;

/**
 * Units a fleet waits for before it will sail on an invasion. **[GEN]**
 *
 * Six, which is a stack that can take an undefended Village outright and put a real siege on a
 * Town. Below that a landing is a donation: the men cannot retreat, cannot be reinforced inside a
 * season, and meet a garrison that is fighting behind walls on its own ground.
 */
const LANDING_FORCE = 6;

/**
 * Field armies a realm must have before it will pull one off the line for an invasion. **[GEN]**
 *
 * Three. An expedition takes a stack away from the land war for years, so a realm with one or two
 * armies has no business mounting one — it would be trading the war it is in for an island.
 */
const ARMIES_BEFORE_SAILING = 3;

/**
 * How much further a realm will sail to reach a landmass **no realm has settled**. **[GEN]**
 *
 * Larger than any sea distance the map can produce, so it is a hard ordering rather than a weight:
 * an unclaimed island is always preferred to a foreign coast, however much closer the coast is.
 */
const VIRGIN_ISLAND_BONUS = 10_000;

/**
 * How much longer the march must be than the sail before a realm ships an army it could walk.
 * **[GEN]**
 *
 * Three, with a floor of twelve tiles so short hops are never shipped. The real ratio of the two
 * speeds is six — foot makes half a tile a month, a fleet three — so three is deliberately
 * conservative: it takes a march that is *twice* as slow as the crossing before a realm bothers with
 * boats, which leaves plenty of room for the loading, the waiting and the landing that shipping
 * costs and marching does not.
 */
const SEA_SHORTCUT = 3;
const SEA_SHORTCUT_FLOOR = 12;

/**
 * How near a realm's own ground a fleet may not unload, in tiles walked. **[GEN]**
 *
 * Six. Inside that the army could simply have marched, so putting it ashore there is a fleet
 * undoing its own work — which is precisely the bug this replaces.
 */
const HOME_SHORE = 6;

/**
 * Where a realm means to put an army ashore.
 *
 * `water` is the sea tile the fleet sails to; `beach` is the land tile beside it that the troops
 * step onto. Both are carried because the landing is the point — a sea tile with no landable
 * ground beside it is a destination worth nothing.
 */
interface Expedition {
  city: CityState;
  water: number;
  beach: number;
  /** Tiles of sea between the realm's own coast and `water`. Decides which target is nearest. */
  distance: number;
}

/**
 * A realm's naval month, in the order the pieces have to happen.
 *
 * `willAttack` is the realm's scruples, handed in from `ai.ts` rather than reimplemented here, so
 * a Peaceful realm sails to independent cities and not to a rival's and an Honorable one still
 * refuses to pile onto a realm already under siege — the same rules it fights by on land.
 */
export function runNavy(
  state: SimState,
  world: World,
  factionIndex: number,
  home: Int32Array,
  willAttack: (city: CityState) => boolean,
  /**
   * True when the realm's land war has run out — nothing it can march to and beat.
   *
   * This is the Britons on their island and the Moors in North Africa: realms that take everything
   * their continent offers and then, having no objective, quietly stop playing for a century. A
   * realm in that position should be pouring everything into the sea, because the sea is the only
   * direction left, and it should want a bigger navy than a realm still busy on land.
   */
  landlocked: boolean,
): void {
  const fleets = [...fleetsOf(state, factionIndex)].sort((a, b) => a.id - b.id);

  const mine = state.cities.filter((city) => city.ownerIndex === factionIndex);
  const ports = mine.filter(
    (city) => !city.siege && canEmbarkFrom(city.buildings) && isCoastal(world, city.tileIndex),
  );

  // No harbour and nothing at sea means there is no naval decision to make at all. A realm with a
  // fleet still afloat is handled even if it has just lost every port.
  if (ports.length === 0 && fleets.length === 0) return;

  const appetite = navalAppetite(
    mine.length,
    landlocked,
    spareLift(state, world, factionIndex, home, willAttack),
    ports,
    fleets,
  );

  /**
   * **The local half of the naval month, and it runs every month.**
   *
   * Landing, loading and launching are all decisions about the four tiles around something — they
   * need no target and no map sweep, so there is no reason to make them on the planning cadence,
   * and every reason not to. Gating them behind the annual plan was measured doing exactly the
   * damage it looks like it would: a realm with 8 free berths and a two-unit army standing on the
   * quay beside them left it there, because it was not that realm's month to think about ships.
   *
   * Ordered as it is for a reason: put men ashore before taking more aboard, and launch last, so a
   * hull finished this month is not launched into a fleet that has already sailed.
   */
  // Where a hostile warship can reach. Computed once for the whole naval month — `keepBusy` needs it
  // every month for the transports it sends to quays, not only the annual plan for the crossings.
  const menaced = menacedWater(state, world, factionIndex);

  for (const fleet of fleets) {
    if (stackSize(fleet.cargo) > 0) putAshore(state, world, fleet, home);
  }
  loadUp(state, world, factionIndex, ports);
  for (const city of ports) putToSea(state, world, city, appetite);
  // Shipbuilding sweeps nothing — it is a decision about one settlement's queue — so it belongs
  // here with the rest of the local work rather than behind the annual plan, which capped every
  // realm on the map at one hull a year however large it was.
  buildFleet(state, world, factionIndex, ports, appetite);
  keepBusy(state, world, factionIndex, ports, menaced);

  /**
   * **The plan is made once a year, staggered by realm.**
   *
   * Everything below sweeps the map: a breadth-first pass over every sea tile to measure sailing
   * distance, and another over every coast to find landing sites. Doing that for thirteen realms
   * every month was the single most expensive thing in the tick — it tripled the cost of a
   * century-long campaign — and it bought nothing, because **an amphibious operation is a matter of
   * years, not months.** The transports alone take six months to build; a realm that reconsiders
   * its invasion twelve times while it waits for them is not making a finer decision, it is making
   * the same one over and over.
   *
   * Staggering on faction index spreads the thirteen sweeps across the year rather than paying for
   * all of them in January, and it keeps the schedule a pure function of the tick — no timer, no
   * stored counter, nothing to migrate.
   */
  const month = Math.floor(state.tick / TICKS_PER_MONTH);
  if (month % PLANNING_MONTHS !== factionIndex % PLANNING_MONTHS) return;

  /**
   * **Is there anything across the water worth crossing for?** — asked before any map is swept.
   *
   * A realm with the whole map in reach by land has no naval decision to make. Answering that costs
   * a scan of the city list, and the cheap tests come first, so `willAttack` only runs for the
   * handful of settlements that genuinely have no land route.
   */
  const overseas = state.cities.some(
    (city) =>
      city.ownerIndex !== factionIndex &&
      !Number.isFinite(reachedIn(home, city.tileIndex)) &&
      willAttack(city),
  );
  if (!overseas) return;

  // One sweep, from every stretch of water this realm's harbours touch and from its own fleets.
  // The sea twin of the land `home` sweep.
  const seas = sailingDistanceFrom(world, [
    ...ports.flatMap((city) => seaBeside(world, city.tileIndex)),
    ...fleets.map((fleet) => fleet.tileIndex),
  ]);

  const target = expedition(state, world, factionIndex, home, seas, willAttack);
  if (!target) return;

  /**
   * **A fleet waits at the quay until it is carrying a landing force worth landing.**
   *
   * This is the concentration rule at sea, and it matters more here than anywhere on land: an army
   * put ashore alone on a hostile island cannot retreat, cannot be reinforced quickly, and dies to
   * the first garrison it meets. Sailing with two units aboard because two units happened to be on
   * the quay that month is how a realm loses six expeditions in a row.
   *
   * So a loaded fleet sails when it holds `LANDING_FORCE` units, **or** when it is full — a fleet
   * with three berths left and nothing else coming should not wait for ever. `callToThePort` keeps
   * summoning stacks to the quayside in the meantime, and `loadUp` keeps taking the part that fits.
   */
  /**
   * **Loaded fleets spread across several beaches, not all onto one** — owner-specified in 0.18.4
   * ("make landings from unexpected places, with more than one stack if required").
   *
   * `expedition` names the best landing; `otherLandings` names the rest, one per reachable coast.
   * Fleets are dealt round them in id order, so a realm with four loaded convoys puts men ashore in
   * four places rather than queueing all four behind the same headland — which is both harder to
   * defend against and far more likely to find a beach nobody is watching.
   *
   * The first fleet always takes the chosen target, so a realm with one convoy behaves exactly as
   * it did before.
   */
  const beaches = [
    target,
    ...otherLandings(state, world, factionIndex, seas, target, maxBeaches(mine.length)),
  ];
  let dealt = 0;
  for (const fleet of fleets) {
    const aboard = stackSize(fleet.cargo);
    if (aboard === 0) continue;
    const { capacity, used } = berths(fleet);
    if (aboard < LANDING_FORCE && used < capacity && waitingForMore(state, world, fleet)) continue;
    setCourse(state, world, fleet, beaches[dealt % beaches.length] ?? target, menaced);
    dealt += 1;
  }

  /**
   * **One harbour of departure, chosen for being nearest the target by sea** — and it is now only
   * where the *army* is summoned to, not where the ships are built.
   *
   * Hulls used to be built here and nowhere else, on the reasoning that eight of them spread across
   * four anchorages is four fleets of two, and fleets of two carried nothing at all back when an
   * army could not be split. Splitting exists now (decision 129) and a lone transport is a useful
   * thing, so concentration is no longer worth capping a whole empire's shipyards to get.
   *
   * What still has to concentrate is the **landing force**. An army is summoned to one quay, and
   * `loadUp` will put it aboard whatever fleet is alongside.
   *
   * A second sweep, outward from the landing water, is what says which port that is. `seas` runs
   * the other way — from all our coasts at once — so it can say how far the target is but not which
   * harbour it is far from. Once a year, per realm, and only when there is a target.
   */
  const toTarget = sailingDistanceFrom(world, [target.water]);
  const base = nearestPort(world, ports, toTarget);
  if (!base) return;

  callToThePort(state, world, factionIndex, base, home);
}

/** Whichever of a realm's harbours the landing water is closest to, by sea. */
function nearestPort(
  world: World,
  ports: readonly CityState[],
  toTarget: Int32Array,
): CityState | undefined {
  let best: CityState | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const city of ports) {
    for (const water of seaBeside(world, city.tileIndex)) {
      const distance = reachedIn(toTarget, water);
      // Ties break on the lower city index, as everywhere else, so the base does not wander.
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = city;
    }
  }
  return best;
}

/**
 * What is worth crossing for — **an unclaimed island first, and only then the nearest thing**.
 *
 * Two conditions decide whether a settlement is a candidate at all, and the first is the one that
 * matters: it must be **unreachable on foot**. A realm never sails somewhere it could walk —
 * shipping an army to a city it shares a continent with is a slower, more expensive, drownable way
 * of doing what marching already does. That single test keeps this out of the land AI's way. The
 * second is that there is somewhere to land: a beach on the target's landmass, beside water this
 * realm can sail to. A city on an island with no landable shore is a rumour, not a target.
 *
 * **The sort is where Ireland was being lost.** Picking purely by distance meant every realm chose
 * whichever foreign coastline happened to be closest — and those are almost always cities on big
 * landmasses that some *other* realm already lives on, which is to say somebody else's land war
 * reached by boat. Measured over 120 years: Novgorod chosen 173 times, Tunis 90, Edinburgh 55 …
 * and **Dublin 6**. Ireland was never anybody's nearest anything, so nobody ever went.
 *
 * So a landmass **no realm holds a settlement on** outranks distance outright. Those are the places
 * the naval phase exists for — Ireland, Sardinia, Crete, Cyprus — and they are also the honest
 * prize: virgin ground, no rival dug into it, and a realm that takes one owns an island. Distance
 * still decides between two of them, and still decides everything once they are all spoken for.
 *
 * Ties break on the lowest city index, as everywhere else in the AI, so a realm does not oscillate
 * between two equally distant islands and cross to neither.
 */
function expedition(
  state: SimState,
  world: World,
  factionIndex: number,
  home: Int32Array,
  seas: Int32Array,
  willAttack: (city: CityState) => boolean,
): Expedition | undefined {
  /**
   * Candidates, cheaply — and **a long march counts as across the water** (owner-specified, 0.18.3).
   *
   * The original test was "no land route at all", on the reasoning that marching is always better
   * than shipping. That is true of a border province and plainly false of the far end of the
   * Mediterranean: foot crosses a tile every **two months** and a fleet crosses three tiles in one,
   * so a coastal city forty tiles away round the Italian peninsula is six years' marching and under
   * a year's sailing. A realm that insists on walking there arrives with an army the winters have
   * eaten.
   *
   * So a settlement qualifies if there is no land route **or** the walk is more than
   * `SEA_SHORTCUT` times the sail. `judge` and the ordinary land AI still handle everything nearer;
   * this only catches the ones where the sea is genuinely the sensible road.
   */
  const wanted = state.cities.filter((city) => {
    if (city.ownerIndex === factionIndex) return false;
    if (!willAttack(city)) return false;

    const byLand = reachedIn(home, city.tileIndex);
    if (!Number.isFinite(byLand)) return true;

    const bySea = Math.min(
      ...seaBeside(world, city.tileIndex).map((water) => reachedIn(seas, water)),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(bySea)) return false;
    return byLand > SEA_SHORTCUT * bySea + SEA_SHORTCUT_FLOOR;
  });
  if (wanted.length === 0) return undefined;

  // Landmasses somebody has already settled. Cheap, and computed once for the whole sort.
  const spokenFor = new Set(
    state.cities
      .filter((city) => state.factions[city.ownerIndex]?.ai !== null || city.ownerIndex === state.playerFactionIndex)
      .map((city) => landmassOf(world, city.tileIndex)),
  );

  const landings = landingsByLandmass(state, world, factionIndex, seas);
  let best: Expedition | undefined;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const city of wanted) {
    const landmass = landmassOf(world, city.tileIndex);
    const site = landings.get(landmass);
    if (!site) continue;

    // Virgin ground first, then distance. The offset is larger than any sea distance on the map,
    // so an unclaimed island always outranks a held coast however far away it is.
    const rank = site.distance + (spokenFor.has(landmass) ? VIRGIN_ISLAND_BONUS : 0);
    if (rank >= bestRank) continue;

    bestRank = rank;
    best = { city, water: site.water, beach: site.beach, distance: site.distance };
  }
  return best;
}

interface Landing {
  water: number;
  beach: number;
  distance: number;
}

/**
 * The closest sailable water tile with landable ground beside it, **for every landmass at once**.
 *
 * One pass over the map, not one per candidate city. The first version of this asked the question
 * per settlement, which is forty-odd full sweeps of 2,450 tiles per realm per month and turned a
 * century-long test from 35 seconds into 200. Inverting the loop — walk the water once, and file
 * each shore under the landmass it belongs to — gives the same answer for the same cost as one of
 * the old queries.
 *
 * "Landable" is decision 124's permissive half: any coastal tile the realm does not have to own and
 * on which nothing hostile is standing. A settlement's tile is excluded — an army cannot land on
 * top of a defended city, it lands beside one and marches in.
 */
function landingsByLandmass(
  state: SimState,
  world: World,
  factionIndex: number,
  seas: Int32Array,
): Map<number, Landing> {
  const best = new Map<number, Landing>();

  // Occupied ground, gathered once. The inner loop below runs on every coastal tile of the map, so
  // a linear scan of the city and army lists inside it is what made the old version quadratic.
  const settled = new Set(state.cities.map((city) => city.tileIndex));
  const hostile = new Set(
    state.armies.filter((army) => army.ownerIndex !== factionIndex).map((army) => army.tileIndex),
  );

  for (let water = 0; water < seas.length; water++) {
    const distance = seas[water] ?? UNREACHABLE;
    if (distance === UNREACHABLE) continue;

    for (const beach of seaNeighbours(world, water)) {
      const landmass = landmassOf(world, beach);
      if (landmass === 0) continue;
      if (settled.has(beach) || hostile.has(beach)) continue;

      const held = best.get(landmass);
      // Ties break on the lower water index so the choice is fixed across machines and reloads.
      if (held && (held.distance < distance || (held.distance === distance && held.water <= water))) {
        continue;
      }
      best.set(landmass, { water, beach, distance });
    }
  }
  return best;
}

/**
 * Lay down what the expedition still needs — transports first, then an escort.
 *
 * Transports lead because a fleet with escorts and no berths cannot carry anything, and the whole
 * operation is about carrying something. The escort matters enormously all the same: cargo is lost
 * with the ship (decision 126), so an unescorted convoy meeting one Light Ship loses the army as
 * well as the boats.
 *
 * Ordered one hull a month per harbour, like every other queue in the AI, and only where the realm
 * can pay — `queueShip` also refuses if the settlement has no people to crew it or the realm is at
 * its manpower ceiling, which is exactly the gate the player's own panel applies.
 */
/**
 * What the realm's navy is short of, counted across everything it owns or has on a slipway.
 *
 * One count, used by both the builder and the launcher, so a port cannot decide it has a full
 * complement while the shipwright thinks otherwise.
 */
interface NavalAppetite {
  hulls: number;
  escorts: number;
  /** Escorts owed to the Transports **already afloat**, as opposed to the ones eventually planned. */
  escortsDue: number;
  berths: number;
  wantsHulls: number;
  wantsEscorts: number;
  wantsBerths: number;
  /** Nothing more is coming — every hull the realm means to build is built. */
  complete: boolean;
}

/**
 * **Armies' worth of men this realm has standing about with no land war to march to.**
 *
 * The demand signal `convoysWanted` is built on, and the whole point of the rewrite: a realm should
 * want shipping in proportion to the troops that have nowhere to walk, not to the cities it owns.
 *
 * "No land war" is asked **per landmass**, not per realm, and that distinction is the useful half.
 * `landlocked` is already a realm-wide flag and it is far too blunt for this — an empire fighting
 * hard in Anatolia while thirty stacks sit idle in a conquered Iberia has a land war by any
 * realm-wide test, and those thirty stacks are exactly the ones the boats are for. So a stack counts
 * as spare when there is nothing on **its own** landmass that this realm would attack and could
 * reach on foot.
 *
 * Counted in **units rather than stacks**, then divided by a full army, because a stack is not a
 * fixed quantity of men: three one-unit raiders are not three armies' worth of shipping, and the
 * figure the owner asked about — "forty armies' worth" — is a figure about men.
 *
 * Claiming stacks are excluded: they are one unit each and have a job on this side of the water.
 * Guards are **not** excluded, because a guard on a landmass with nothing to attack has no border to
 * watch and `order` hands it straight back to the field force (decision 154) — it is cargo, and the
 * owner watched twenty of them sit in Cyprus beside a fleet with free berths.
 */
export function spareLift(
  state: SimState,
  world: World,
  factionIndex: number,
  home: Int32Array,
  willAttack: (city: CityState) => boolean,
): number {
  // Landmasses with something on them this realm would attack and could walk to. The cheap tests go
  // first and a landmass already known to be contested short-circuits the rest of its own cities,
  // so `willAttack` runs a handful of times rather than once per settlement.
  const contested = new Set<number>();
  for (const city of state.cities) {
    if (city.ownerIndex === factionIndex) continue;
    const landmass = landmassOf(world, city.tileIndex);
    if (landmass === 0 || contested.has(landmass)) continue;
    if (!Number.isFinite(reachedIn(home, city.tileIndex))) continue;
    if (!willAttack(city)) continue;
    contested.add(landmass);
  }

  let idle = 0;
  for (const army of armiesOf(state, factionIndex)) {
    if (army.role === 'claim') continue;
    if (contested.has(landmassOf(world, army.tileIndex))) continue;
    idle += stackSize(army.units);
  }
  return Math.ceil(idle / MAX_ARMY_UNITS);
}

function navalAppetite(
  cities: number,
  landlocked: boolean,
  lift: number,
  ports: readonly CityState[],
  fleets: readonly FleetState[],
): NavalAppetite {
  const afloat: UnitStack = {};
  for (const fleet of fleets) {
    for (const [id, count] of Object.entries(fleet.ships)) afloat[id] = (afloat[id] ?? 0) + count;
  }
  for (const city of ports) {
    for (const [id, count] of Object.entries(city.fleet)) afloat[id] = (afloat[id] ?? 0) + count;
    for (const order of city.shipQueue) afloat[order.id] = (afloat[order.id] ?? 0) + 1;
  }

  // Hulls, not kinds of hull, so the figure stays right however many escorts a realm wants.
  const escorts = Object.entries(afloat).reduce(
    (n, [id, count]) => n + (shipById(id)?.carries === 0 ? count : 0),
    0,
  );

  // The plan is made in convoys and read out in hulls, so the order matters: how many armies the
  // realm means to lift decides the escort, and the two together decide the ceiling.
  const convoys = convoysWanted(cities, lift);
  const wantsEscorts = escortsWanted(cities, landlocked, convoys);
  const wantsHulls = hullsWanted(cities, landlocked, convoys, wantsEscorts);
  const wantsBerths = BERTHS_WANTED * convoys;
  const hulls = stackSize(afloat);
  const berths = fleetCapacity(afloat);

  /**
   * **The escort the hold already afloat needs, right now** — the figure that makes a large escort
   * target safe, added in 0.19.1.
   *
   * `wantsEscorts` is the plan; this is the instalment due. `buildFleet` lays down an escort only
   * while the realm is behind *this*, so warships and Transports come off the slipways in step at
   * three to four rather than the whole escort arriving before the first hull that carries anything.
   *
   * That distinction is the entire reason 0.18.9's attempt to raise the escort target destroyed
   * overseas conquest — measured, a large realm built two dozen warships before its first transport
   * and took 0 of 7 marooned settlements. The plan can be as large as the owner likes now, because
   * the *order* no longer follows from its size.
   *
   * The `+ 1` is a seed: a realm with no transports at all still wants one warship, both to cover the
   * first Transport the month it launches and because a lone hunter is useful on its own.
   */
  const convoysAfloat = Math.ceil(transportsIn(afloat) / MAX_FLEET_TRANSPORTS);
  const escortsDue = Math.min(wantsEscorts, convoysAfloat * ESCORTS_PER_CONVOY + 1);

  return {
    hulls,
    escorts,
    escortsDue,
    berths,
    wantsHulls,
    wantsEscorts,
    wantsBerths,
    complete: hulls >= wantsHulls || (berths >= wantsBerths && escorts >= wantsEscorts),
  };
}

/**
 * Lay down hulls — **at every port, every month**, and escorts before transports.
 *
 * Two changes from the version that produced eight fleets in a world, both deliberate.
 *
 * **Every port, monthly.** Building at the single base once a year capped a realm at one hull a
 * year however large it was, so a twenty-city empire built its navy at exactly the rate a village
 * did. Shipbuilding sweeps nothing and needs no target — it is a decision about one settlement's
 * queue — so there was never a reason for it to sit behind the annual plan.
 *
 * **Escorts first, but only up to what the hold afloat is owed** — the 0.19.1 shape.
 *
 * Escorts-before-transports looks backwards and is not: `putToSea` launches a harbour's moorings
 * when they hold a landing force, so whatever is built *last* tends to be left behind. With
 * transports first the convoy sailed the moment it had berths and the escort followed months later
 * as a second fleet of one, which is neither an escort nor a fleet.
 *
 * What was wrong was measuring that priority against the **whole plan**. At one escort per convoy
 * the difference never showed; at the three the owner asked for in 0.19.1 it would be decades of
 * warships before a realm built anything that could carry an army — precisely the failure 0.18.9
 * measured and could not get past. So the test is `escortsDue`, which is the escort owed to the
 * Transports the realm *has*, and the two come off the slipways together at three to four.
 */
function buildFleet(
  state: SimState,
  world: World,
  factionIndex: number,
  ports: readonly CityState[],
  appetite: NavalAppetite,
): void {
  if (appetite.hulls >= appetite.wantsHulls) return;

  const wantTransport = appetite.berths < appetite.wantsBerths;
  /**
   * The instalment while there is still hold to build; the whole plan once there is not.
   *
   * The first clause is what keeps a big escort target from starving the hold (see `escortsDue`).
   * The second is what finally builds the **war fleet** the owner asked for: once a realm can lift
   * every army it means to, every further hull is a warship, and those are the squadrons that go
   * hunting rather than escorting.
   */
  const wantEscort =
    appetite.escorts < appetite.escortsDue ||
    (!wantTransport && appetite.escorts < appetite.wantsEscorts);
  if (!wantEscort && !wantTransport) return;

  /**
   * **Build where the troops are** — owner-specified in 0.18.6.
   *
   * `ports` arrives in city-index order, and once a realm is near its hull ceiling only the first
   * few entries ever get a queue. City index is essentially the order the map file lists them in, so
   * a realm would build its entire navy at whichever harbour happened to be listed first — the owner
   * watched an empire produce everything at **Cyprus** while its armies stood in northern Europe.
   *
   * Sorting by how many of the realm's own armies are standing at or beside each harbour puts the
   * hulls where the cargo already is. Ties fall back to city index, so the order is still fixed.
   */
  const busiest = [...ports].sort(
    (a, b) => armiesNear(state, world, factionIndex, b) - armiesNear(state, world, factionIndex, a) ||
      a.cityIndex - b.cityIndex,
  );

  for (const base of busiest) {
    // One hull at a time per harbour. A queue is a commitment of gold and men, and a realm that
    // stacked six of them at one port would starve every other queue it has.
    if (base.shipQueue.length > 0) continue;

    const options = buildableShips(base.buildings).filter((ship) =>
      wantEscort ? ship.carries === 0 : ship.carries > 0,
    );
    // The strongest escort the harbour and the treasury will bear; for transports there is only one
    // hull that carries anything, so the sort is a formality that keeps the choice fixed.
    const pick = [...options]
      .sort((a, b) => b.size * b.hp * b.damage - a.size * a.hp * a.damage || a.id.localeCompare(b.id))
      .find((ship) => canAfford(state, factionIndex, ship.cost));
    if (!pick) continue;

    queueShip(state, base, pick.id);
  }
}

/**
 * Put the base's moored hulls to sea, once there are enough of them to be worth the crossing.
 *
 * **A realm does not launch a single transport and hope.** It waits until the harbour holds berths
 * for a landing force that could actually be loaded, then sends everything at once — launching hull
 * by hull as each is finished is what produced fleets of two transports that no army fitted in.
 *
 * An escort alone may sail: a warship is useful at sea whether or not there is anything to carry.
 */
/**
 * **A fleet is never idle** — owner-specified in 0.18.3.
 *
 * A hull swinging at anchor is a hull drawing upkeep and crewed by men the manpower ceiling counted.
 * Every month, any fleet with no route and nothing aboard is given a job, in this order:
 *
 * 1. **Hunt.** An enemy fleet within `HUNTING_RANGE`, if this one has a warship in it — closing on
 *    it starts a battle, which is what a navy is for. Transports never hunt: a convoy that sails at
 *    a warship is a convoy that drowns.
 * 2. **Go where the army is.** An empty transport sails to whichever of the realm's harbours has a
 *    field army standing in it, because that is the one place it can become useful. Ferrying was
 *    already handled by `loadUp`; what was missing was the boat ever *going* to the quay.
 * 3. **Go home.** Failing both, make for the nearest friendly harbour rather than sit in open water.
 *
 * Every order goes through `orderSail`, so an impossible route is simply not taken and the fleet
 * tries again next month.
 */
function keepBusy(
  state: SimState,
  world: World,
  factionIndex: number,
  ports: readonly CityState[],
  menaced: ReadonlySet<number>,
): void {
  for (const fleet of [...fleetsOf(state, factionIndex)]) {
    // The list is walked over a copy because `escortDuty` can merge this fleet out of existence.
    if (!state.fleets.includes(fleet)) continue;
    if (fleet.path.length > 0 || stackSize(fleet.cargo) > 0) continue;

    /**
     * **Escort duty outranks the hunt** — owner-reported in 0.19.2.
     *
     * A warship built after its convoy had sailed used to have no way of ever joining it: it
     * launched as a fleet of its own, went hunting or took station off a rival's coast, and the
     * convoy crossed alone. Every rule for putting escorts *in* a convoy worked at the quayside and
     * only at the quayside, which is why the owner kept seeing holds of four ships and nothing else.
     *
     * Above hunting on purpose. A warship that leaves an unescorted hold to chase something is doing
     * the enemy's work for it: cargo drowns with the ship (decision 126), so the convoy it abandoned
     * is worth more than the transport it catches.
     */
    if (hasWarship(fleet.ships) && escortDuty(state, world, factionIndex, fleet, menaced)) continue;
    if (!state.fleets.includes(fleet)) continue;

    if (hasWarship(fleet.ships) && hunt(state, world, fleet)) continue;

    // Whichever harbour has troops waiting; failing that, the nearest harbour at all. Straight-line
    // distance is enough to choose between them — `orderSail` does the real routing.
    const quays = ports.filter((city) =>
      seaBeside(world, city.tileIndex).some((water) => water !== fleet.tileIndex),
    );
    if (quays.length === 0) continue;

    const waiting = quays.filter((city) =>
      state.armies.some(
        (army) => army.ownerIndex === factionIndex && army.tileIndex === city.tileIndex,
      ),
    );
    /**
     * **A pure warship with nothing to chase takes station off a rival-s coast** — owner-reported
     * in 0.18.9: ten flagships parked in an enclosed sea and five more beside England, "not moving
     * or attacking".
     *
     * Hunting only fires when an enemy fleet is already in range, so a navy whose rival keeps its
     * ships in port had no work at all and fell through to going home. A rival-s coastal settlement
     * is where its convoys must appear, so sitting on the water beside one is both the aggressive
     * move and the useful one: anything that sails is intercepted the moment it does.
     *
     * **Pure warships only.** A fleet with berths is needed at home — measured, sending convoys off
     * to blockade stranded the armies marching to meet them and cut overseas conquest by four
     * fifths.
     */
    if (fleetCapacity(fleet.ships) === 0 && hasWarship(fleet.ships) && blockade(state, world, fleet)) {
      continue;
    }

    const target = nearestOf(world, fleet.tileIndex, waiting.length > 0 ? waiting : quays);
    if (!target) continue;

    /**
     * Sail to the water beside it, not onto it — a fleet cannot enter a land tile.
     *
     * **A hull that can carry cargo goes the safe way** (0.19.1). An empty Transport steaming to a
     * quay is not carrying an army yet, but it is the thing that will, and losing it on the way is
     * how a realm ends up with troops on a quay and nothing to put them in. A pure warship routes
     * straight through: running into the enemy is the errand.
     */
    const carrier = fleetCapacity(fleet.ships) > 0;
    const berth = nearestWater(world, fleet.tileIndex, seaBeside(world, target.tileIndex));
    if (berth !== undefined && berth !== fleet.tileIndex) {
      if (carrier && orderSail(state, world, fleet.id, berth, menaced).ok) continue;
      orderSail(state, world, fleet.id, berth);
    }
  }
}

/**
 * Sail at the enemy. Returns true if a course was set.
 *
 * **Several candidates, nearest first, since 0.19.1.** It used to take the single nearest quarry and
 * give up if `orderSail` could not find water to it — which was tolerable while hunting was capped at
 * thirty tiles and the nearest thing was usually in the same sea. With the cap gone (see
 * `HUNTING_RANGE`) the nearest enemy fleet by straight line is frequently in a sea this one cannot
 * reach at all, and a war fleet would decline the whole idea and go home rather than sail at the
 * perfectly reachable squadron behind it.
 *
 * **A loaded enemy convoy is worth more than an empty warship**, so cargo breaks the tie before
 * distance does: drowning an army is the most valuable thing a navy can do (decision 126), and it is
 * the one thing this fleet is uniquely able to prevent.
 */
function hunt(state: SimState, world: World, fleet: FleetState): boolean {
  const quarries = state.fleets
    .filter((other) => other.ownerIndex !== fleet.ownerIndex)
    .map((other) => ({
      fleet: other,
      laden: stackSize(other.cargo) > 0 ? 0 : 1,
      distance: chebyshevTiles(world, fleet.tileIndex, other.tileIndex),
    }))
    .filter((entry) => entry.distance <= HUNTING_RANGE)
    // Ties on the lower id, so two of our fleets never trade places chasing each other's targets.
    .sort((a, b) => a.laden - b.laden || a.distance - b.distance || a.fleet.id - b.fleet.id)
    .slice(0, HUNTING_TRIES);

  for (const quarry of quarries) {
    if (orderSail(state, world, fleet.id, quarry.fleet.tileIndex).ok) return true;
  }
  return false;
}

/** How many quarries a war fleet will consider before giving up on a hunt. **[GEN]** */
const HUNTING_TRIES = 8;

/**
 * **Go and join the convoy that has no escort.** Returns true if this fleet did anything.
 *
 * The missing half of the escort rules, added in 0.19.2. Everything before it put warships into a
 * convoy *at the quayside* — `oneConvoy` gathers whatever is moored, `launch` reinforces the fleet
 * alongside — and none of it could help a warship finished after its convoy had already sailed. The
 * owner's report was the symptom: convoys of four Transports and nothing else, with warships of the
 * same realm off hunting somewhere.
 *
 * Two steps, because two fleets cannot occupy one tile:
 *
 * 1. **Adjacent already** — merge, taking as much as fits (`mergeFleets` is partial since 0.19.2).
 * 2. **Not yet** — sail for the water beside it, avoiding menaced tiles on the way, because a lone
 *    escort caught before it arrives has helped nobody.
 *
 * The convoy chosen is the **worst escorted, nearest first**: a hold with no warship at all outranks
 * one that merely wants a third, and among equals the nearest wins. Ties on the lower fleet id, so
 * two escorts never trade places covering each other's convoys.
 */
function escortDuty(
  state: SimState,
  world: World,
  factionIndex: number,
  escort: FleetState,
  menaced: ReadonlySet<number>,
): boolean {
  // A fleet that is itself carrying berths is a convoy, not an escort; it has its own crossing to
  // make and stripping it to cover another would only move the problem.
  if (fleetCapacity(escort.ships) > 0) return false;

  const needy = state.fleets
    .filter(
      (other) =>
        other.ownerIndex === factionIndex &&
        other.id !== escort.id &&
        transportsIn(other.ships) > 0 &&
        warshipsIn(other.ships) < ESCORTS_PER_CONVOY &&
        // Room for at least one more hull, or there is nothing to give it.
        stackSize(other.ships) < MAX_FLEET_SHIPS,
    )
    .map((other) => ({
      fleet: other,
      short: ESCORTS_PER_CONVOY - warshipsIn(other.ships),
      distance: chebyshevTiles(world, escort.tileIndex, other.tileIndex),
    }))
    .sort((a, b) => b.short - a.short || a.distance - b.distance || a.fleet.id - b.fleet.id);

  for (const candidate of needy) {
    const convoy = candidate.fleet;

    if (seaNeighbours(world, escort.tileIndex).includes(convoy.tileIndex)) {
      // Into the convoy, not the other way about: the convoy keeps its id, its cargo and its orders.
      if (mergeFleets(state, convoy.id, escort.id).ok) return true;
      continue;
    }

    const berth = nearestWater(
      world,
      escort.tileIndex,
      seaNeighbours(world, convoy.tileIndex).filter((tile) => isWater(world, tile)),
    );
    if (berth === undefined || berth === escort.tileIndex) continue;
    if (orderSail(state, world, escort.id, berth, menaced).ok) return true;
    if (orderSail(state, world, escort.id, berth).ok) return true;
  }
  return false;
}

/** Hulls in a stack that carry nothing — the escort, as opposed to the hold. */
function warshipsIn(ships: UnitStack): number {
  return Object.entries(ships).reduce(
    (n, [id, count]) => n + (shipById(id)?.carries === 0 ? count : 0),
    0,
  );
}

/**
 * How far a warship will sail to pick a fight, in tiles. **[GEN]**
 *
 * **No limit since 0.19.1** — owner-specified: *"a war fleet should always look to find and destroy
 * enemy ships."* It was fifteen tiles, then thirty, on the reasoning that a navy should patrol its
 * own sea rather than cross the map after one transport and leave its coast open.
 *
 * The owner's answer to that worry is the right one: a warship sitting off its own coast is not
 * defending it, because nothing is coming. What threatens a realm's shipping is the enemy's navy,
 * and the way to stop a navy is to sink it wherever it happens to be. The figure is larger than the
 * map's own diagonal so that nothing is ever out of range, and `orderSail` still declines a quarry
 * there is no water route to — which is what keeps a fleet in an enclosed sea from setting out after
 * something it could never reach.
 */
const HUNTING_RANGE = Number.POSITIVE_INFINITY;

function chebyshevTiles(world: World, a: number, b: number): number {
  return Math.max(
    Math.abs((a % world.width) - (b % world.width)),
    Math.abs(Math.floor(a / world.width) - Math.floor(b / world.width)),
  );
}

function nearestOf(
  world: World,
  from: number,
  cities: readonly CityState[],
): CityState | undefined {
  let best: CityState | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (const city of cities) {
    const distance = chebyshevTiles(world, from, city.tileIndex);
    if (distance >= nearest) continue;
    nearest = distance;
    best = city;
  }
  return best;
}

function nearestWater(world: World, from: number, water: readonly number[]): number | undefined {
  let best: number | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (const tile of water) {
    const distance = chebyshevTiles(world, from, tile);
    if (distance >= nearest) continue;
    nearest = distance;
    best = tile;
  }
  return best;
}

/** The realm's own armies standing on this harbour or on the ground touching it. */
function armiesNear(
  state: SimState,
  world: World,
  factionIndex: number,
  city: CityState,
): number {
  const around = new Set([city.tileIndex, ...seaNeighbours(world, city.tileIndex)]);
  return state.armies.filter(
    (army) => army.ownerIndex === factionIndex && around.has(army.tileIndex),
  ).length;
}

/**
 * Cast off, once the moorings hold a convoy rather than a boat.
 *
 * The old test — berths enough, **or any warship at all** — launched a lone escort the month it was
 * finished, as a fleet of one with nothing to escort. Now a harbour waits until it has berths for a
 * real landing force, and only sails short when **nothing more is coming**: the realm has built
 * every hull it means to, so waiting would be waiting for ever.
 *
 * A warship with no transports is still worth having at sea whatever else is true — it is the only
 * thing that can close a strait, and it needs no cargo to do it.
 *
 * **A hold does not sail alone** — owner-reported in 0.19.2: *"transport ships still don't have
 * escorts with them in their fleet, 4 ships only."* This was the cause. The berth test was met by
 * four Transports the month the fourth was finished, so the convoy cast off as a fleet of four and
 * whatever escort the yards were still building had nothing left to join. `oneConvoy` had always
 * been willing to take warships along; there were simply never any moored at the moment it looked.
 *
 * So a carrier convoy waits for its escort — but **only for one this harbour is actually going to
 * get**, which is the narrower rule the first attempt got wrong. Shipbuilding places hulls at the
 * port with the most troops beside it, so a realm's escorts and its Transports are routinely laid
 * down in different harbours; a hold that waits for a warship moored two hundred miles away waits
 * for ever. Measured on the first attempt: four fleets at sea in 1470 where there had been nine, with
 * the rest of the hulls tied up in port waiting for each other.
 *
 * A harbour therefore waits only while **it has a warship on its own slipway**. Everything else
 * sails, and `escortDuty` brings the escort out to it — which is what that rule is for, and why an
 * unescorted convoy at sea is a temporary state rather than a permanent one. A hold that does sail
 * alone still routes round trouble (decision 166).
 */
function putToSea(state: SimState, world: World, base: CityState, appetite: NavalAppetite): void {
  const moored = base.fleet;
  if (stackSize(moored) === 0) return;

  const enough = fleetCapacity(moored) >= BERTHS_WANTED;
  const escortOnly = fleetCapacity(moored) === 0 && hasWarship(moored);
  if (!enough && !escortOnly && !appetite.complete) return;

  // An escort this harbour is building is worth the wait; one somewhere else is not.
  const escortComing = base.shipQueue.some((order) => shipById(order.id)?.carries === 0);
  if (!escortOnly && !hasWarship(moored) && escortComing) return;

  launch(state, world, base, oneConvoy(state, world, base, moored));
}

/**
 * As much of a harbour's moorings as one convoy may take — **at most four Transports**.
 *
 * A fleet's hold is four Transports and therefore exactly one army (`MAX_FLEET_TRANSPORTS`), so
 * launching ten of them at once is not a bigger invasion, it is a `too-many-transports` refusal and
 * a harbour that never empties. The surplus stays moored and sails as a second convoy — next month,
 * or onto another of the eight water tiles around the port once this one has moved off.
 *
 * Warships are not capped: they fill the remaining sixteen berths of the fleet, which is what an
 * escort is for. Transports are taken first so a convoy is never all escort and no hold, and both
 * are walked in sorted id order so the same harbour always launches the same ships.
 */
function oneConvoy(
  state: SimState,
  world: World,
  base: CityState,
  moored: UnitStack,
): UnitStack {
  // A fleet already lying off this harbour is the one `launch` will reinforce, so its hulls count
  // against both limits before a single new one is chosen.
  const alongside = seaBeside(world, base.tileIndex)
    .map((tile) => fleetAt(state, tile))
    .find((fleet) => fleet !== undefined && fleet.ownerIndex === base.ownerIndex);

  let carriers = alongside ? transportsIn(alongside.ships) : 0;
  let hulls = alongside ? stackSize(alongside.ships) : 0;

  const picks: UnitStack = {};
  const isCarrier = (id: string) => (shipById(id)?.carries ?? 0) > 0;
  const order = [...Object.keys(moored)].sort(
    (a, b) => Number(isCarrier(b)) - Number(isCarrier(a)) || a.localeCompare(b),
  );

  for (const id of order) {
    const room = isCarrier(id)
      ? Math.min(MAX_FLEET_TRANSPORTS - carriers, MAX_FLEET_SHIPS - hulls)
      : MAX_FLEET_SHIPS - hulls;
    const take = Math.min(moored[id] ?? 0, Math.max(0, room));
    if (take <= 0) continue;

    picks[id] = take;
    hulls += take;
    if (isCarrier(id)) carriers += take;
  }
  return picks;
}

/**
 * Walk an army aboard, at a Dock, exactly as the player would.
 *
 * The stack chosen is the **largest field army standing in a port with berths for it**, because a
 * landing force that arrives understrength is an army delivered to a country that will kill it. A
 * claiming or guarding stack is never taken: those have jobs on this side of the water.
 */
function loadUp(
  state: SimState,
  world: World,
  factionIndex: number,
  ports: readonly CityState[],
): void {
  const harbours = new Set(ports.map((city) => city.tileIndex));
  const fleets = [...fleetsOf(state, factionIndex)].sort((a, b) => a.id - b.id);

  for (const fleet of fleets) {
    const { capacity, used } = berths(fleet);
    const room = capacity - used;
    if (room <= 0) continue;

    const quay = seaNeighbours(world, fleet.tileIndex).filter((tile) => harbours.has(tile));
    if (quay.length === 0) continue;

    /**
     * **Any field army or raiding column on the quay, whatever its size.**
     *
     * Size stopped mattering in 0.18.1: the part that fits goes and the rest stays ashore
     * (decision 129). **Role stopped mattering in 0.18.4**, and that one was doing real damage.
     *
     * Once every realm has taken its own landmass, a stack with nothing to do walks to a harbour to
     * wait for shipping — and `order` sends *raiders* there as readily as field armies, because a
     * raider that cannot reach anything to raid is just as stuck. This filtered on `field` alone, so
     * those columns stood on the quay for ever while the boats beside them sailed empty. Measured at
     * 1600: Spain had **11 armies waiting on quays, 21 fleets, and 1 of them loaded**.
     *
     * Shipping a raiding column is also exactly the guerilla behaviour a weaker realm wants — a
     * fast stack landed on an undefended coast is worth far more than the same stack at home.
     *
     * Guards and claimers never appear here: `order` returns before they could be sent to a quay,
     * because both have work where they stand.
     */
    const army = armiesOf(state, factionIndex)
      .filter(
        (candidate: ArmyState) =>
          (candidate.role === 'field' || candidate.role === 'raid') &&
          quay.includes(candidate.tileIndex) &&
          stackSize(candidate.units) > 0,
      )
      .sort((a, b) => stackSize(b.units) - stackSize(a.units) || a.id - b.id)[0];
    if (!army) continue;

    embark(state, world, fleet.id, army.id, fitting(army.units, room));
  }
}

/**
 * March an army to the quayside, when a fleet is waiting with berths and nobody has come.
 *
 * Without this the AI could only ever load an army that **happened** to be standing in a port —
 * which does occur, because a coastal settlement with a garrison surplus musters its stack on its
 * own tile, but it is luck rather than intent. A realm would build a fleet, launch it, and leave
 * it riding at anchor for a decade while its armies fought inland.
 *
 * Deliberately **one army a month, and only an idle one.** The expedition is what a realm does with
 * what it can spare, so this never pulls a stack off a march it is already committed to, and never
 * strips the field force in a single month. A claiming or guarding stack is never called: those
 * have jobs on this side of the water.
 *
 * `campaign` runs before this and only re-orders armies with no route, so the order sticks: next
 * month the army is walking and the land AI leaves it alone.
 */
function callToThePort(
  state: SimState,
  world: World,
  factionIndex: number,
  base: CityState,
  home: Int32Array,
): void {
  const alongside = seaNeighbours(world, base.tileIndex)
    .map((tile) => state.fleets.find((f) => f.tileIndex === tile))
    .find((f) => f !== undefined && f.ownerIndex === factionIndex);
  if (!alongside) return;

  const { capacity, used } = berths(alongside);
  if (capacity - used < 2) return;

  // Somebody is already on the quay — either they will board, or they are too big to and a second
  // stack standing behind them would not help.
  if (
    state.armies.some(
      (army) => army.ownerIndex === factionIndex && army.tileIndex === base.tileIndex,
    )
  ) {
    return;
  }

  /**
   * A field army for the crossing — **and it may be one that already has somewhere to be.**
   *
   * This is where the whole feature was dying. `campaign` runs before this every month and hands an
   * order to every idle stack, so by the time the navy gets a look in, **no army in the realm has an
   * empty route**. The first version filtered on `path.length === 0` and therefore found nothing,
   * for ever: measured, the Turks ended a campaign with 81 armies and eight harbours, sitting four
   * sea-tiles from an undefended Cyprus they never once sailed for.
   *
   * So the expedition is allowed to *take* a stack rather than wait for one to be spare — the
   * nearest to the quay, on the reasoning that it is the one whose current orders cost least to
   * cancel. Two guards keep this from gutting the land war: it happens **once a year** at most, and
   * only when the realm has stacks to spare, so a realm fighting for its life with two armies is
   * never stripped to one.
   *
   * Not filtered on fitting the berths, since splitting exists (decision 129): the part that fits
   * crosses, and the rest stays in a friendly port, which is where a second wave wants to be anyway.
   */
  const mine = armiesOf(state, factionIndex).filter(
    (army: ArmyState) =>
      army.role === 'field' &&
      stackSize(army.units) > 0 &&
      // Reachable on foot. An army on another landmass cannot walk to this quay.
      Number.isFinite(reachedIn(home, army.tileIndex)),
  );
  if (mine.length < ARMIES_BEFORE_SAILING) return;

  const summoned = [...mine]
    .filter((army) => army.tileIndex !== base.tileIndex)
    .sort(
      (a, b) =>
        reachedIn(home, a.tileIndex) - reachedIn(home, b.tileIndex) ||
        stackSize(b.units) - stackSize(a.units) ||
        a.id - b.id,
    )[0];

  if (summoned) orderMove(state, world, summoned.id, base.tileIndex);
}

/**
 * Put a loaded fleet's men ashore — checked every month, but **only somewhere worth landing**.
 *
 * The cheap half of the naval month, and the half that must never wait on the planning cadence: an
 * army left floating beside the coast it crossed an ocean for is paying upkeep, risking a warship
 * and doing nothing. Costs a look at the four tiles around the fleet.
 *
 * **The landmass filter is the whole rule.** Without it this fired the month after loading and put
 * the army straight back down on its own shore — the quay a fleet loads at is beside a coast, and
 * that coast is a perfectly valid landing site. Measured, that made every expedition a round trip
 * of two tiles: over 120 years, not one fleet was ever carrying anything when looked at, because it
 * unloaded before it sailed.
 *
 * So a fleet only lands where its realm **holds no settlement on that landmass**. That is exactly
 * the expedition case, and it is self-limiting in the right way: once the beachhead has taken a
 * city, the island is somewhere the realm lives, and moving troops there is the land AI's problem
 * rather than a landing.
 */
function putAshore(state: SimState, world: World, fleet: FleetState, home: Int32Array): void {
  const beach = landingSites(state, world, fleet)
    // **Not on our own doorstep.** Without some rule here the fleet unloaded the month after it
    // loaded — the quay a fleet loads at is beside a coast, and that coast is a perfectly valid
    // landing site. Measured before the rule existed, no fleet was ever seen carrying anything over
    // 120 years, because every expedition was a round trip of two tiles.
    //
    // The test used to be "a landmass we hold no settlement on", which was right while the only
    // reason to sail was to reach another landmass. Since 0.18.3 a realm also ships an army the long
    // way round its **own** continent (see `SEA_SHORTCUT`), so the rule had to become one about
    // distance rather than geography: land anywhere that is not a few tiles from home.
    .filter((tile) => reachedIn(home, tile) > HOME_SHORE)
    .sort((a, b) => a - b)[0];

  if (beach !== undefined) {
    disembark(state, world, fleet.id, beach);
    return;
  }

  /**
   * **No empty beach: fight for one** — owner-specified in 0.18.5.
   *
   * Only ever reached when `landingSites` came back with nothing worth using, which on a contested
   * coast is common: an enemy army standing on the shore blocks a landing outright, so a convoy that
   * crossed an ocean would circle offshore until its escorts deserted.
   *
   * Troops only. A settlement is still never a landing site (that rule predates this one and
   * survives it), so this storms a beach held by an army, not a city held by walls.
   */
  const held = seaNeighbours(world, fleet.tileIndex)
    .filter((tile) => !isWater(world, tile))
    .filter((tile) => reachedIn(home, tile) > HOME_SHORE)
    .filter((tile) => !state.cities.some((city) => city.tileIndex === tile))
    .filter((tile) => {
      const standing = state.armies.find((army) => army.tileIndex === tile);
      return standing !== undefined && standing.ownerIndex !== fleet.ownerIndex;
    })
    .sort((a, b) => a - b)[0];

  if (held !== undefined) stormBeach(state, world, fleet, held);
}

/**
 * Is anything actually coming, or is this fleet waiting for a ship that will never arrive?
 *
 * Waiting for a full landing force is only sensible while the realm still has troops it could put
 * aboard. A fleet lying at a quay in a realm with no army left to give it should take what it has
 * and go, or it waits for ever with four men and a hundred years of upkeep.
 */
function waitingForMore(state: SimState, world: World, fleet: FleetState): boolean {
  const quay = seaNeighbours(world, fleet.tileIndex);
  return armiesOf(state, fleet.ownerIndex).some(
    (army) => army.role === 'field' && (quay.includes(army.tileIndex) || army.path.length > 0),
  );
}

/**
 * Point a loaded fleet at the expedition's landing water.
 *
 * A fleet with a route already laid in is left alone. Re-planning a crossing is how a realm ends up
 * with a transport tacking between two islands until its escort deserts — which is the same reason
 * the plan itself is annual rather than monthly.
 */
/**
 * Every other coast this realm could put men on, one per landmass, nearest first.
 *
 * The supply of "unexpected places". `expedition` picks the single best beach and every convoy used
 * to sail for it; this hands back the runners-up so they can be dealt out instead. A landing on a
 * coast nobody is watching is worth more than a fifth stack behind the same headland, and against a
 * realm that has learned to garrison one beach it is the only thing that works.
 *
 * Cheap: it reuses the same `landingsByLandmass` sweep the target came from.
 */
function otherLandings(
  state: SimState,
  world: World,
  factionIndex: number,
  seas: Int32Array,
  chosen: Expedition,
  beaches: number,
): Expedition[] {
  const held = new Set(
    state.cities
      .filter((city) => city.ownerIndex === factionIndex)
      .map((city) => landmassOf(world, city.tileIndex)),
  );

  return [...landingsByLandmass(state, world, factionIndex, seas).entries()]
    .filter(([landmass, site]) => !held.has(landmass) && site.water !== chosen.water)
    .sort((a, b) => a[1].distance - b[1].distance || a[1].water - b[1].water)
    .slice(0, beaches)
    .map(([, site]) => ({ city: chosen.city, water: site.water, beach: site.beach, distance: site.distance }));
}

/**
 * How many separate beaches a realm will land on at once — **scaled to the realm since 0.19.1**.
 *
 * It was a flat four, counting the chosen one, and the owner asked that a large faction be able to
 * make more landings than that. A realm of a dozen cities still gets three; an empire of sixty gets
 * seven, which is seven coasts a defender has to watch at once. Below that the scattering worry the
 * flat figure was chosen for is real — single stacks put ashore faster than any of them can take a
 * city — but it is a worry about a *small* realm's armies, not a large one's. **[GEN]**
 */
export function maxBeaches(cities: number): number {
  return Math.max(3, Math.min(7, 2 + Math.floor(cities / 10)));
}

/**
 * **Water a convoy will not sail through** — every tile a hostile warship can reach this tick.
 *
 * A warship intercepts anything ending a tick within one tile of it (decision 125) and cargo drowns
 * with the hull it was riding (decision 126), so the tile a warship is on and the eight around it are
 * not a risk to a loaded transport, they are a certainty. The owner's rule — *transports should not
 * directly go into enemy warships* — is therefore exactly this set, treated as land.
 *
 * **Only fleets carrying a warship menace anything.** Two transport convoys pass each other
 * untouched, so an enemy convoy is not a hazard and routing around one would be superstition.
 *
 * Computed once per realm per naval month; it is a scan of the fleet list and eight neighbours each,
 * against a fleet count that is dozens at the very most.
 */
export function menacedWater(state: SimState, world: World, factionIndex: number): Set<number> {
  const menaced = new Set<number>();
  for (const fleet of state.fleets) {
    if (fleet.ownerIndex === factionIndex) continue;
    if (!hasWarship(fleet.ships)) continue;
    menaced.add(fleet.tileIndex);
    for (const tile of seaNeighbours(world, fleet.tileIndex)) menaced.add(tile);
  }
  return menaced;
}

/**
 * Point a loaded fleet at its landing water, **round the enemy's warships rather than through them**.
 *
 * Owner-specified in 0.19.1, and the first half of what the escort rule below is for. Three tries,
 * in order, and the order is the whole rule:
 *
 * 1. **A clear route**, avoiding every tile a hostile warship covers. Taken whenever one exists,
 *    escorted or not — a convoy that can go round has no business going through.
 * 2. **The direct route, if the convoy is escorted.** Sometimes there is no way round: a strait is
 *    corked, or the target coast is the one being watched. A convoy with warships of its own may
 *    force it, which is what the warships are for.
 * 3. **Nothing, if it is not.** An unescorted hold with no safe road waits in port. It will sail
 *    when the escort it is owed is built, or when the blockade moves — and waiting costs upkeep,
 *    where sailing costs the army.
 *
 * A fleet with a route already laid in is left alone. Re-planning a crossing is how a realm ends up
 * with a transport tacking between two islands until its escort deserts — which is the same reason
 * the plan itself is annual rather than monthly.
 */
function setCourse(
  state: SimState,
  world: World,
  fleet: FleetState,
  target: Expedition,
  menaced: ReadonlySet<number>,
): void {
  if (fleet.path.length > 0) return;
  if (fleet.tileIndex === target.water) return;
  if (!isWater(world, target.water)) return;

  // No route is not a failure to report — the target was chosen from a sweep that only knows about
  // open water, and a strait can be corked by a hostile fleet between the sweep and the order.
  if (findSeaPath(state, world, fleet, target.water, fleet.tileIndex, menaced) !== null) {
    orderSail(state, world, fleet.id, target.water, menaced);
    return;
  }

  if (!hasWarship(fleet.ships)) return;
  if (findSeaPath(state, world, fleet, target.water) === null) return;
  orderSail(state, world, fleet.id, target.water);
}

/**
 * Take station off a rival's coast.
 *
 * The nearest hostile coastal settlements by straight line, tried in turn — `orderSail` decides
 * whether the water actually connects, and returns false if it does not, which is how a fleet in an
 * enclosed sea quietly declines and falls through to going home.
 *
 * Independents count. They hold coastal cities, they are everybody's expansion, and a fleet sitting
 * off one is in the right place for the landing that follows.
 */
function blockade(state: SimState, world: World, fleet: FleetState): boolean {
  const hostile = state.cities.filter(
    (city) => city.ownerIndex !== fleet.ownerIndex && isCoastal(world, city.tileIndex),
  );
  if (hostile.length === 0) return false;

  const nearest = [...hostile]
    .sort(
      (a, b) =>
        chebyshevTiles(world, fleet.tileIndex, a.tileIndex) -
          chebyshevTiles(world, fleet.tileIndex, b.tileIndex) || a.cityIndex - b.cityIndex,
    )
    .slice(0, BLOCKADE_TRIES);

  for (const city of nearest) {
    const berth = nearestWater(world, fleet.tileIndex, seaBeside(world, city.tileIndex));
    if (berth === undefined || berth === fleet.tileIndex) continue;
    if (orderSail(state, world, fleet.id, berth).ok) return true;
  }
  return false;
}

/** How many hostile ports a fleet will consider before giving up on a station. **[GEN]** */
const BLOCKADE_TRIES = 6;
