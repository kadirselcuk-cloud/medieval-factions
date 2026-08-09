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
 * A realm with no land war left wants more of both — see `navalAppetite`. **[GEN]**
 */
function escortsWanted(cities: number, landlocked: boolean): number {
  return Math.min(14, 1 + Math.floor(cities / 4) + (landlocked ? 3 : 0));
}

function hullsWanted(cities: number, landlocked: boolean): number {
  // Raised again in 0.18.6: at 60 a 56-city empire with 31 harbours had **no shipyard queue busy
  // anywhere**, which is the same wall 0.18.5 knocked down one notch lower.
  return Math.min(140, 12 + cities * 2 + (landlocked ? 20 : 0));
}

/**
 * Whole armies a realm wants to be able to lift at once, and therefore the berths it builds for.
 *
 * **This was the cap on everything** — owner-specified in 0.18.5. `BERTHS_WANTED` was a flat twenty,
 * one army's worth, for every realm on the map. Measured at 1600 the dominant realm held 45 cities,
 * **17 million gold, 797,000 wood, and was using 2.4% of its manpower ceiling** — and had stopped
 * building ships entirely, with not one shipyard queue busy anywhere in the realm, because it had
 * 29 hulls against a ceiling of 28.
 *
 * A power like that should be able to put five armies to sea at once and does not notice the cost.
 * Being unable to move more than one is what left forty stacks wandering around Iberia while the
 * war it wanted was across the water.
 */
function convoysWanted(cities: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor(cities / 10)));
}

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

  const appetite = navalAppetite(mine.length, landlocked, ports, fleets);

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
  for (const fleet of fleets) {
    if (stackSize(fleet.cargo) > 0) putAshore(state, world, fleet, home);
  }
  loadUp(state, world, factionIndex, ports);
  for (const city of ports) putToSea(state, world, city, appetite);
  // Shipbuilding sweeps nothing — it is a decision about one settlement's queue — so it belongs
  // here with the rest of the local work rather than behind the annual plan, which capped every
  // realm on the map at one hull a year however large it was.
  buildFleet(state, world, factionIndex, ports, appetite);
  keepBusy(state, world, factionIndex, ports);

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
  const beaches = [target, ...otherLandings(state, world, factionIndex, seas, target)];
  let dealt = 0;
  for (const fleet of fleets) {
    const aboard = stackSize(fleet.cargo);
    if (aboard === 0) continue;
    const { capacity, used } = berths(fleet);
    if (aboard < LANDING_FORCE && used < capacity && waitingForMore(state, world, fleet)) continue;
    setCourse(state, world, fleet, beaches[dealt % beaches.length] ?? target);
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
  berths: number;
  wantsHulls: number;
  wantsEscorts: number;
  wantsBerths: number;
  /** Nothing more is coming — every hull the realm means to build is built. */
  complete: boolean;
}

function navalAppetite(
  cities: number,
  landlocked: boolean,
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

  const wantsHulls = hullsWanted(cities, landlocked);
  const wantsEscorts = escortsWanted(cities, landlocked);
  const hulls = stackSize(afloat);
  const berths = fleetCapacity(afloat);

  return {
    hulls,
    escorts,
    berths,
    wantsHulls,
    wantsEscorts,
    wantsBerths: BERTHS_WANTED * convoysWanted(cities),
    complete:
      hulls >= wantsHulls ||
      (berths >= BERTHS_WANTED * convoysWanted(cities) && escorts >= wantsEscorts),
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
 * **Escorts first.** This looks backwards and is not. `putToSea` launches a harbour's moorings when
 * they hold a landing force, so whatever is built *last* tends to be left behind: with transports
 * first, the convoy sailed the moment it had berths and the escort followed months later as a
 * second fleet of one, which is neither an escort nor a fleet. Building the escort first leaves it
 * tied up while the transports accumulate around it, and they all sail together.
 */
function buildFleet(
  state: SimState,
  world: World,
  factionIndex: number,
  ports: readonly CityState[],
  appetite: NavalAppetite,
): void {
  if (appetite.hulls >= appetite.wantsHulls) return;

  const wantEscort = appetite.escorts < appetite.wantsEscorts;
  const wantTransport = appetite.berths < appetite.wantsBerths;
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
): void {
  for (const fleet of fleetsOf(state, factionIndex)) {
    if (fleet.path.length > 0 || stackSize(fleet.cargo) > 0) continue;

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

    // Sail to the water beside it, not onto it — a fleet cannot enter a land tile.
    const berth = nearestWater(world, fleet.tileIndex, seaBeside(world, target.tileIndex));
    if (berth !== undefined && berth !== fleet.tileIndex) {
      orderSail(state, world, fleet.id, berth);
    }
  }
}

/** Sail at the nearest enemy fleet worth catching. Returns true if a course was set. */
function hunt(state: SimState, world: World, fleet: FleetState): boolean {
  let quarry: FleetState | undefined;
  let nearest = Number.POSITIVE_INFINITY;

  for (const other of state.fleets) {
    if (other.ownerIndex === fleet.ownerIndex) continue;
    const distance = chebyshevTiles(world, fleet.tileIndex, other.tileIndex);
    // Ties on the lower id, so two of our fleets never trade places chasing each other's targets.
    if (distance > HUNTING_RANGE || distance > nearest) continue;
    if (distance === nearest && quarry && other.id > quarry.id) continue;
    nearest = distance;
    quarry = other;
  }

  if (!quarry) return false;
  return orderSail(state, world, fleet.id, quarry.tileIndex).ok;
}

/**
 * How far a warship will sail to pick a fight, in tiles. **[GEN]**
 *
 * Fifteen — five months' sailing. Far enough that a navy patrols a sea rather than a harbour mouth,
 * near enough that it does not cross the map to chase one transport and leave its own coast open.
 */
const HUNTING_RANGE = 30;

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
 */
function putToSea(state: SimState, world: World, base: CityState, appetite: NavalAppetite): void {
  const moored = base.fleet;
  if (stackSize(moored) === 0) return;

  const enough = fleetCapacity(moored) >= BERTHS_WANTED;
  const escortOnly = fleetCapacity(moored) === 0 && hasWarship(moored);
  if (!enough && !escortOnly && !appetite.complete) return;

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
): Expedition[] {
  const held = new Set(
    state.cities
      .filter((city) => city.ownerIndex === factionIndex)
      .map((city) => landmassOf(world, city.tileIndex)),
  );

  return [...landingsByLandmass(state, world, factionIndex, seas).entries()]
    .filter(([landmass, site]) => !held.has(landmass) && site.water !== chosen.water)
    .sort((a, b) => a[1].distance - b[1].distance || a[1].water - b[1].water)
    .slice(0, MAX_BEACHES)
    .map(([, site]) => ({ city: chosen.city, water: site.water, beach: site.beach, distance: site.distance }));
}

/**
 * How many separate beaches a realm will land on at once. **[GEN]**
 *
 * Four, counting the chosen one. More than that and a realm is scattering single stacks around the
 * map faster than any of them can take a city.
 */
const MAX_BEACHES = 3;

function setCourse(
  state: SimState,
  world: World,
  fleet: FleetState,
  target: Expedition,
): void {
  if (fleet.path.length > 0) return;
  if (fleet.tileIndex === target.water) return;
  if (!isWater(world, target.water)) return;

  // No route is not a failure to report — the target was chosen from a sweep that only knows about
  // open water, and a strait can be corked by a hostile fleet between the sweep and the order.
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
