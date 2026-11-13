// Fork: the Couch TV scene look (github.com/Seagey/couch-tv, MIT; the scene pictures were made for couch-tv and are free
// to use, see public/scenes/CREDITS.md). Each scene is a photo, a big clock filled with a frosted copy of that photo, and
// the scenery cut out of the photo drawn OVER the clock, so the peaks overlap the digits. The scene follows the sun:
// night, dawn, a clear or a foggy day, golden hour. Only the scene on screen and the one fading in are drawn.

import {useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {dateText, dayName, timeParts, type TimeFormat} from '../lib/clock';
import type {WeatherView} from '../lib/weather';
import {WeatherGlyph} from './Glyph';

export type SceneId = 'night' | 'golden' | 'water' | 'fog' | 'dawn';

interface SceneDef {id: SceneId; fg: boolean; water?: number}
const SCENES: Record<SceneId, SceneDef> = {
	night: {id: 'night', fg: true},
	golden: {id: 'golden', fg: true},
	water: {id: 'water', fg: false, water: 0.55},      // the clock sits on the water: above sharp, below a blurred reflection
	fog: {id: 'fog', fg: true},
	dawn: {id: 'dawn', fg: true}
};

const hi = (): boolean => (window.devicePixelRatio || 1) > 1.2;
const pic = (id: string, ext: string, twoX: boolean): string => `scenes/scene-${id}${twoX && hi() ? '@2x' : ''}${ext}`;

/** The sun's height over the horizon in degrees, and the hour angle (negative before solar noon). */
function solar (lat: number, lon: number, d: Date): {alt: number; hourAngle: number} {
	const start = Date.UTC(d.getUTCFullYear(), 0, 0);
	const day = Math.floor((d.getTime() - start) / 86400000);
	const b = (2 * Math.PI / 365) * (day - 81);
	const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
	const decl = 23.45 * Math.sin(b) * (Math.PI / 180);
	const utc = d.getUTCHours() + d.getUTCMinutes() / 60;
	const solarTime = (utc + lon / 15 + eot / 60 + 24) % 24;
	const ha = (solarTime - 12) * 15 * (Math.PI / 180);
	const la = lat * (Math.PI / 180);
	const s = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
	return {alt: Math.asin(Math.max(-1, Math.min(1, s))) * (180 / Math.PI), hourAngle: ha * (180 / Math.PI)};
}

/** Which scene fits now: night after dusk, dawn and golden hour near the horizon, fog on a grey day, water on a clear one. */
export function sceneFor (now: Date, geo: {lat: number; lon: number} | null, weather: WeatherView | null): SceneId {
	// testing: localStorage 'hearth-scene-force' = one scene id shows that scene (removing it goes back to the sun)
	try { const f = window.localStorage.getItem('hearth-scene-force') as SceneId | null; if (f && SCENES[f]) return f; } catch (e) { /* no storage */ }
	if (!geo) {
		const h = now.getHours();
		if (h >= 5 && h < 8) return 'dawn';
		if (h >= 8 && h < 16) return 'water';
		if (h >= 16 && h < 19) return 'golden';
		return 'night';
	}
	const p = solar(geo.lat, geo.lon, now);
	if (p.alt < -6) return 'night';
	if (p.alt < 10) return p.hourAngle < 0 ? 'dawn' : 'golden';
	const grey = !!weather && ['fog', 'cloud', 'rain', 'snow', 'storm'].indexOf(weather.icon) !== -1;
	return grey ? 'fog' : 'water';
}

function GlassClock ({text, scene, under}: {text: string; scene: SceneId; under?: boolean}) {
	const ref = useRef<HTMLDivElement>(null);
	// the fill shows the frosted photo at the place on screen where each digit is (a background fixed to the screen)
	useLayoutEffect(() => {
		const c = ref.current;
		const f = c && (c.querySelector('.gclock__fill') as HTMLElement | null);
		if (!c || !f) return;
		f.style.backgroundPosition = `${-(c.offsetLeft + f.offsetLeft)}px ${-(c.offsetTop + f.offsetTop)}px`;
		const w = SCENES[scene].water;
		if (w) {
			// above the waterline sharp, below it the reflection; the clips reach past the box on the open sides
			const line = window.innerHeight * w - c.offsetTop;
			c.style.clipPath = under ? `inset(${line}px -50% -50% -50%)` : `inset(-50% -50% ${c.offsetHeight - line}px -50%)`;
		}
	});
	return (
		<div ref={ref} class={`gclock${under ? ' gclock--under' : ''}`}>
			<span class="gclock__fill" style={{backgroundImage: `url(scenes/scene-${scene}-glass.jpg)`}}>{text}</span>
			<span class="gclock__sheen">{text}</span>
			<span class="gclock__rim">{text}</span>
		</div>
	);
}

function Scene ({id, on, text}: {id: SceneId; on: boolean; text: string}) {
	const s = SCENES[id];
	return (
		<div class={`scene scene--${id}${on ? ' scene--on' : ''}`}>
			<img class="scene__bg" src={pic(id, '.jpg', true)} alt="" />
			<div class="scene__shade" />
			<GlassClock text={text} scene={id} />
			{s.water && <GlassClock text={text} scene={id} under />}
			{s.fg && <img class="scene__fg" src={pic(`${id}-fg`, '.webp', true)} alt="" />}
		</div>
	);
}

interface Props {
	now: Date;
	format: TimeFormat;
	geo: {lat: number; lon: number} | null;
	weather: WeatherView | null;
	/** a key was pressed lately: a scene change waits (it costs a weak TV a visible stall) */
	busySince?: number;
}

/** The scene look: the scene that fits the time of day (cross-fading when it changes) and the date line above its clock. */
export function Scenes ({now, format, geo, weather}: Props) {
	const want = sceneFor(now, geo, weather);
	const [shown, setShown] = useState<{cur: SceneId; prev: SceneId | null}>({cur: want, prev: null});
	useEffect(() => {
		if (want === shown.cur) return undefined;
		setShown({cur: want, prev: shown.cur});
		const t = window.setTimeout(() => setShown((v) => ({cur: v.cur, prev: null})), 1800);
		return () => window.clearTimeout(t);
	}, [want]);                                                                 // eslint-disable-line react-hooks/exhaustive-deps
	const {time} = timeParts(now, format);
	const h = now.getHours();
	const night = h >= 21 || h < 6;
	const ids: SceneId[] = shown.prev ? [shown.prev, shown.cur] : [shown.cur];
	return (
		<div class={`scenes${night ? ' scenes--late' : ''} scenes--show-${shown.cur}`}>
			{ids.map((id) => <Scene key={id} id={id} on={id === shown.cur} text={time} />)}
			<div class="scenes__date">
				{weather && <span class="scenes__wx"><WeatherGlyph icon={weather.icon} />{weather.main}</span>}
				<span class="scenes__day">{dayName(now)} {dateText(now)}</span>
			</div>
		</div>
	);
}
