import { describe, expect, it } from 'vitest';
import { defaultClimate } from '../src/core/types';
import {
  defaultCalendar,
  defaultStarSystem,
  homeYearDays,
  listBodies,
  moonPeriodDays,
  moonPeriodDisplay,
  orbitTheta,
  planetPeriodDays,
  siderealToSynodic,
  switchMoonPeriodMode,
  synodicToSidereal,
} from '../src/core/astro';

describe('astro calendar / orbits', () => {
  const sys = defaultStarSystem(42, defaultClimate());

  it('default calendar has year/month and moon periods', () => {
    const cal = defaultCalendar(sys);
    expect(cal.daysPerYear).toBe(365);
    expect(cal.daysPerMonth).toBeGreaterThan(0);
    expect(cal.moonPeriodMode).toBe('sidereal');
    expect(Object.keys(cal.moonPeriodDays ?? {}).length).toBe(sys.home.moons.length);
  });

  it('synodic/sidereal convert back and forth', () => {
    const yd = 365;
    const sid = 27.3;
    const syn = siderealToSynodic(sid, yd);
    expect(syn).toBeGreaterThan(sid);
    expect(synodicToSidereal(syn, yd)).toBeCloseTo(sid, 2);
  });

  it('switch mode changes display but animation stays sidereal', () => {
    const mid = sys.home.moons[0].id;
    const withCal = { ...sys, calendar: switchMoonPeriodMode(sys, 'synodic') };
    const sid = moonPeriodDays(withCal, mid, sys.home.id);
    const disp = moonPeriodDisplay(withCal, mid, sys.home.id);
    expect(disp).toBeGreaterThan(sid);
  });

  it('planet period uses calendar override in days', () => {
    const withCal = {
      ...sys,
      calendar: { ...(sys.calendar ?? defaultCalendar(sys)), planetPeriodDays: { [sys.home.id]: 400 } },
    };
    expect(planetPeriodDays(withCal, sys.home.id)).toBe(400);
  });

  it('orbitTheta advances with tDays', () => {
    const o = sys.home.orbit;
    const per = planetPeriodDays({ ...sys, calendar: defaultCalendar(sys) }, sys.home.id);
    const t0 = orbitTheta(o, per, 0);
    const t1 = orbitTheta(o, per, per / 4);
    expect(t1 - t0).toBeCloseTo(Math.PI / 2, 5);
  });

  it('listBodies includes star planets and moons', () => {
    const list = listBodies(sys);
    expect(list.some((b) => b.ref.kind === 'star')).toBe(true);
    expect(list.some((b) => b.ref.kind === 'planet')).toBe(true);
    expect(list.some((b) => b.ref.kind === 'moon')).toBe(true);
    expect(homeYearDays(sys)).toBeGreaterThan(0);
  });
});
