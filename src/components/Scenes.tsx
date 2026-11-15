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

// Fast start: the page renders at 4K (pixel ratio 2), and getting the 4K photo and cut-out ready for the screen took the C5
// about 3 s at a cold start (trace 15.11.2026: two image decodes of 1.5 s and 0.4 s, the first frame waited 2.6 s for them),
// all of it black. So a scene first shows its 1080p pictures (a few hundred ms), and the 4K ones are fetched and decoded
// aside, then swapped in. Remembered for the page's life, so a scene that was sharp once stays sharp.
const sharp: Partial<Record<SceneId, boolean>> = {};
const SHARP_AFTER_MS = 2500;      // the first screen and its first key presses come first

function decoded (src: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const img = new Image();
		img.onload = () => { if (img.decode) img.decode().then(() => resolve(), () => resolve()); else resolve(); };
		img.onerror = () => reject(new Error(src));
		img.src = src;
	});
}

function makeSharp (id: SceneId): Promise<void> {
	const s = SCENES[id];
	return Promise.all([decoded(pic(id, '.jpg', true)), s.fg ? decoded(pic(`${id}-fg`, '.webp', true)) : Promise.resolve()]).then(() => { sharp[id] = true; });
}

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
			{/* macOS 27 glass: each digit catches light on its top-left and bottom-right edges (a masked stroke per character) */}
			<span class="gclock__spec">{text.split('').map((ch, i) => <span key={i}>{ch}</span>)}</span>
		</div>
	);
}

function Scene ({id, on, fade, text}: {id: SceneId; on: boolean; fade: boolean; text: string}) {
	const s = SCENES[id];
	const twoX = !!sharp[id];
	return (
		<div class={`scene scene--${id}${on ? ' scene--on' : ''}${on && fade ? ' scene--fade' : ''}`}>
			<img class="scene__bg" src={pic(id, '.jpg', twoX)} alt="" />
			<div class="scene__shade" />
			<GlassClock text={text} scene={id} />
			{s.water && <GlassClock text={text} scene={id} under />}
			{s.fg && <img class="scene__fg" src={pic(`${id}-fg`, '.webp', twoX)} alt="" />}
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
	// the 4K pictures of the scene on screen, once it is up (see makeSharp)
	const [, setSharpTick] = useState(0);
	useEffect(() => {
		const id = shown.cur;
		if (!hi() || sharp[id]) return undefined;
		let live = true;
		const t = window.setTimeout(() => { makeSharp(id).then(() => { if (live) setSharpTick((n) => n + 1); }, () => { /* stays 1080p */ }); }, SHARP_AFTER_MS);
		return () => { live = false; window.clearTimeout(t); };
	}, [shown.cur]);
	const {time} = timeParts(now, format);
	const h = now.getHours();
	const night = h >= 21 || h < 6;
	const ids: SceneId[] = shown.prev ? [shown.prev, shown.cur] : [shown.cur];
	return (
		<div class={`scenes${night ? ' scenes--late' : ''} scenes--show-${shown.cur}`}>
			{/* fades in only when it replaces another scene: at the first screen it is there at once */}
			{ids.map((id) => <Scene key={id} id={id} on={id === shown.cur} fade={!!shown.prev} text={time} />)}
			<div class="scenes__date">
				{weather && <span class="scenes__wx"><WeatherGlyph icon={weather.icon} />{weather.main}</span>}
				<span class="scenes__day">{dayName(now)} {dateText(now)}</span>
			</div>
		</div>
	);
}
