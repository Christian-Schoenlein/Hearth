// Fork: the Screen saver app (the tile at the end of the home row). Left: the sections; right: every aerial, painting and
// photo the saver can show (from the Mac that makes the daily mix, lib/saverapp.ts), with the ones on the TV today marked.
// OK on a picture opens it big; OK there hides it from the TV (or shows it again). The Settings section sets how many of
// each the mix gets, how long a picture stays, and when the TV turns off; "New mix now" makes today's mix again.

import {useEffect, useRef, useState} from 'preact/hooks';
import {useKeys, clamp, type NavKey} from '../hooks/useKeys';
import {COUNT_STEPS, loadItems, loadState, newMix, onServer, saveCounts, saverServer, setHidden, stepValue,
	type SaverCounts, type SaverItem, type SaverKind, type SaverState} from '../lib/saverapp';
import {SAVER_INTERVAL_VALUES, SAVER_POWEROFF_VALUES, powerOffText} from '../lib/saverconfig';
import {t as tt} from '../i18n';

type Section = 'today' | SaverKind | 'hidden' | 'settings';
const SECTIONS: readonly Section[] = ['today', 'aerials', 'art', 'photos', 'hidden', 'settings'];
const COLS = 4;
const ROWS_SHOWN = 4;          // the grid draws this many rows around the focus (the TV never holds all 386 pictures at once)

interface Props {
	/** seconds a picture stays (Hearth's own saver setting) */
	interval: number;
	/** seconds of saver before the TV turns off (0 = never) */
	powerOff: number;
	onInterval: (v: number) => void;
	onPowerOff: (v: number) => void;
	onClose: () => void;
	/** a pop-up is in front: no keys meanwhile */
	paused?: boolean;
}

const SECTION_KEYS = {today: 'saverapp.section.today', aerials: 'saverapp.section.aerials', art: 'saverapp.section.art', photos: 'saverapp.section.photos', hidden: 'saverapp.section.hidden', settings: 'saverapp.section.settings'} as const;
const ONE_KEYS = {aerials: 'saverapp.one.aerials', art: 'saverapp.one.art', photos: 'saverapp.one.photos'} as const;
const sectionLabel = (s: Section): string => tt(SECTION_KEYS[s]);
const intervalText = (v: number): string => (v < 60 ? tt('saverapp.seconds', {v}) : v === 3600 ? tt('saverconfig.1Hour') : v === 60 ? tt('saverconfig.1Minute') : tt('saverconfig.minutes', {v: v / 60}));

function nextIn (values: readonly number[], value: number, dir: 1 | -1): number {
	const at = values.indexOf(value);
	return at === -1 ? stepValue(values, value, dir) : values[clamp(at + dir, 0, values.length - 1)];
}

export function SaverApp ({interval, powerOff, onInterval, onPowerOff, onClose, paused}: Props) {
	const [items, setItems] = useState<SaverItem[] | null>(null);
	const [state, setState] = useState<SaverState | null>(null);
	const [failed, setFailed] = useState(false);
	const [section, setSection] = useState<Section>('today');
	const [zone, setZone] = useState<'menu' | 'grid'>('menu');
	const [at, setAt] = useState(0);                    // focused picture, or focused settings row
	const [viewer, setViewer] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState('');
	const wasRotating = useRef(false);

	const refresh = () => loadState().then((s) => { setState(s); setFailed(false); return s; });
	useEffect(() => {
		let live = true;
		Promise.all([loadItems(), loadState()]).then(([list, s]) => { if (live) { setItems(list); setState(s); } }, () => { if (live) setFailed(true); });
		return () => { live = false; };
	}, []);

	// while a new mix is being made (the TV downloads new aerials from Apple: a few minutes), ask every 5 s
	useEffect(() => {
		if (!state || !state.rotating) {
			if (wasRotating.current && state) setNote(tt('saverapp.mixDone'));
			wasRotating.current = false;
			return undefined;
		}
		wasRotating.current = true;
		const t = window.setTimeout(() => { refresh().catch(() => undefined); }, 5000);
		return () => window.clearTimeout(t);
	}, [state]);                                                               // eslint-disable-line react-hooks/exhaustive-deps

	// hiding a picture in the Hidden section takes it out of the list under the viewer
	useEffect(() => { if (viewer !== null && viewer >= list.length) setViewer(list.length ? list.length - 1 : null); });

	const hiddenOf = (i: SaverItem): boolean => !!state && (state.hidden[i.kind] || []).indexOf(i.id) !== -1;
	const onTv = (i: SaverItem): boolean => !!state && (state.today[i.kind] || []).indexOf(i.id) !== -1;

	const list: SaverItem[] = !items ? [] : section === 'today' ? items.filter(onTv)
		: section === 'hidden' ? items.filter(hiddenOf)
		: section === 'settings' ? [] : items.filter((i) => i.kind === section);
	const counts: SaverCounts = state ? state.counts : {aerials: 4, art: 15, photos: 15};
	const SETTING_ROWS = 6;
	const rows = section === 'settings' ? SETTING_ROWS : list.length;
	const pos = clamp(at, 0, Math.max(0, rows - 1));

	const pickSection = (s: Section) => { setSection(s); setAt(0); setNote(''); };

	const toggleHidden = (item: SaverItem) => {
		if (busy) return;
		setBusy(true);
		setHidden(item, !hiddenOf(item)).then((r) => { setState((s) => (s ? {...s, hidden: r.hidden} : s)); setBusy(false); }, () => { setBusy(false); setFailed(true); });
	};

	const changeCount = (kind: SaverKind, dir: 1 | -1) => {
		const v = stepValue(COUNT_STEPS[kind], counts[kind], dir);
		if (v === counts[kind] || !state) return;
		setState({...state, counts: {...counts, [kind]: v}});
		setNote(tt('saverapp.countsLater'));
		saveCounts({[kind]: v}).then((c) => setState((s) => (s ? {...s, counts: c} : s)), () => setFailed(true));
	};

	const startMix = () => {
		if (!state || state.rotating) return;
		setState({...state, rotating: true});
		setNote('');
		newMix().then(() => window.setTimeout(() => { refresh().catch(() => undefined); }, 1500), () => setFailed(true));
	};

	const settingsKey = (key: NavKey) => {
		const dir: 1 | -1 = key === 'right' ? 1 : -1;
		if (key === 'up') { if (pos === 0) setZone('menu'); else setAt(pos - 1); return; }
		if (key === 'down') { setAt(Math.min(SETTING_ROWS - 1, pos + 1)); return; }
		if (key === 'enter') { if (pos === 5) startMix(); return; }
		if (key !== 'left' && key !== 'right') return;
		if (pos === 0) changeCount('aerials', dir);
		else if (pos === 1) changeCount('art', dir);
		else if (pos === 2) changeCount('photos', dir);
		else if (pos === 3) onInterval(nextIn(SAVER_INTERVAL_VALUES, interval, dir));
		else if (pos === 4) onPowerOff(nextIn(SAVER_POWEROFF_VALUES, powerOff, dir));
		else if (key === 'left') setZone('menu');
	};

	const handleKey = (key: NavKey): boolean => {
		if (viewer !== null) {
			const n = list.length;
			if (key === 'back') setViewer(null);
			else if (key === 'left' && n) { setViewer((viewer - 1 + n) % n); setAt((viewer - 1 + n) % n); }
			else if (key === 'right' && n) { setViewer((viewer + 1) % n); setAt((viewer + 1) % n); }
			else if (key === 'enter' && list[viewer]) toggleHidden(list[viewer]);
			return true;
		}
		if (key === 'back') { if (zone === 'grid') setZone('menu'); else onClose(); return true; }
		if (zone === 'menu') {
			const s = SECTIONS.indexOf(section);
			if (key === 'up' && s > 0) pickSection(SECTIONS[s - 1]);
			else if (key === 'down' && s < SECTIONS.length - 1) pickSection(SECTIONS[s + 1]);
			else if ((key === 'right' || key === 'enter') && rows) setZone('grid');
			return true;
		}
		if (section === 'settings') { settingsKey(key); return true; }
		const col = pos % COLS;
		if (key === 'left') { if (col === 0) setZone('menu'); else setAt(pos - 1); }
		else if (key === 'right') setAt(Math.min(rows - 1, pos + 1));
		else if (key === 'up') { if (pos >= COLS) setAt(pos - COLS); }
		else if (key === 'down') { if (pos + COLS < rows) setAt(pos + COLS); else if (Math.floor(pos / COLS) < Math.floor((rows - 1) / COLS)) setAt(rows - 1); }
		else if (key === 'enter' && list[pos]) setViewer(pos);
		return true;
	};
	useKeys(handleKey, !paused);

	// ----- drawing -----
	const countOf = (s: Section): number => (!items ? 0 : s === 'today' ? items.filter(onTv).length : s === 'hidden' ? items.filter(hiddenOf).length : s === 'settings' ? 0 : items.filter((i) => i.kind === s).length);
	const focusRow = Math.floor(pos / COLS);
	const lastRow = Math.max(0, Math.floor((list.length - 1) / COLS));
	const firstRow = clamp(focusRow - 1, 0, Math.max(0, lastRow - ROWS_SHOWN + 2));
	const shown = list.slice(firstRow * COLS, (firstRow + ROWS_SHOWN) * COLS);

	const subOf = (i: SaverItem): string => i.sub || i.credit || '';
	const kindName = (k: SaverKind): string => tt(ONE_KEYS[k]);

	const settingRows: {label: string; value: string; detail: string}[] = [
		{label: tt('saverapp.set.aerials'), value: String(counts.aerials), detail: tt('saverapp.set.aerialsDetail')},
		{label: tt('saverapp.set.art'), value: String(counts.art), detail: tt('saverapp.set.artDetail')},
		{label: tt('saverapp.set.photos'), value: String(counts.photos), detail: tt('saverapp.set.photosDetail')},
		{label: tt('saverapp.set.interval'), value: intervalText(interval), detail: tt('saverapp.set.intervalDetail')},
		{label: tt('saverapp.set.powerOff'), value: powerOffText(powerOff), detail: tt('saverapp.set.powerOffDetail')},
		{label: tt('saverapp.set.newMix'), value: state && state.rotating ? tt('saverapp.mixing') : '', detail: tt('saverapp.set.newMixDetail')}
	];

	const viewed = viewer !== null ? list[viewer] : null;
	return (
		<div class="screen sva">
			<div class="sva__side">
				<h1 class="sva__title">{tt('saverapp.title')}</h1>
				<div class="sva__lede">{state && state.day ? tt('saverapp.lede', {a: counts.aerials, p: counts.art, f: counts.photos}) : ' '}</div>
				{SECTIONS.map((s) => (
					<div key={s} class={`sva__nav${s === section ? ' sva__nav--on' : ''}${s === section && zone === 'menu' ? ' sva__nav--focused' : ''}`}>
						<span>{sectionLabel(s)}</span>{s !== 'settings' && items && <span class="sva__n">{countOf(s)}</span>}
					</div>
				))}
				<div class="sva__keys">{tt(zone === 'menu' ? 'saverapp.keysMenu' : section === 'settings' ? 'saverapp.keysSettings' : 'saverapp.keysGrid')}</div>
			</div>

			<div class="sva__main">
				<h2 class="sva__head">{sectionLabel(section)}{section !== 'settings' && <small>{list.length}</small>}</h2>
				{failed && <div class="sva__msg sva__msg--error">{tt('saverapp.unreachable', {server: saverServer().replace(/^https?:\/\//, '')})}</div>}
				{!items && !failed && section !== 'settings' && <div class="sva__msg">{tt('saverapp.loading')}</div>}
				{section === 'settings'
					? (
						<div class="sva__rows">
							{settingRows.map((r, i) => {
								const focused = zone === 'grid' && i === pos;
								return (
									<div key={r.label} class={`sva__row${focused ? ' sva__row--focused' : ''}${i === 5 ? ' sva__row--action' : ''}`}>
										<div class="sva__rowtext"><div class="sva__rowlabel">{r.label}</div><div class="sva__rowdetail">{r.detail}</div></div>
										{i < 5 ? <div class="sva__value">{focused && <span class="sva__arrow">‹</span>}{r.value}{focused && <span class="sva__arrow">›</span>}</div>
											: r.value && <div class="sva__value sva__value--busy">{r.value}</div>}
									</div>
								);
							})}
							{note && <div class="sva__msg">{note}</div>}
						</div>
					)
					: items && !list.length
						? <div class="sva__msg">{tt(section === 'hidden' ? 'saverapp.noneHidden' : 'saverapp.noneToday')}</div>
						: (
							<div class="sva__grid">
								{shown.map((i, n) => {
									const idx = firstRow * COLS + n;
									const h = hiddenOf(i);
									return (
										<div key={i.kind + i.id} class={`sva__tile${zone === 'grid' && idx === pos ? ' sva__tile--focused' : ''}${h ? ' sva__tile--hidden' : ''}`}>
											<div class="sva__img">
												<img src={onServer(i.thumb)} alt="" />
												{onTv(i) && section !== 'today' && <span class="sva__badge">{tt('saverapp.onTv')}</span>}
												{i.video && <span class="sva__play" />}
											</div>
											<div class="sva__t">{h ? tt('saverapp.hiddenPrefix') : ''}{i.title}</div>
											<div class="sva__s">{subOf(i)}</div>
										</div>
									);
								})}
							</div>
						)}
			</div>

			{viewed && (
				<div class="sva__viewer">
					{viewed.video
						? <video class="sva__full" src={viewed.video} poster={onServer(viewed.thumb)} autoPlay muted loop />
						: <img class="sva__full" src={onServer(viewed.full || viewed.thumb)} alt="" />}
					<div class={`sva__bar${viewed.video ? '' : ' sva__bar--plain'}`}>
						{/* paintings and photos carry their own caption in the picture */}
						{viewed.video && <div class="sva__meta">
							<div class="sva__vt">{viewed.title}</div>
							<div class="sva__vs">{[kindName(viewed.kind), subOf(viewed), onTv(viewed) ? tt('saverapp.onTvToday') : ''].filter(Boolean).join(' · ')}</div>
						</div>}
						<div class={`sva__btn${hiddenOf(viewed) ? ' sva__btn--on' : ''}`}>{tt(hiddenOf(viewed) ? 'saverapp.showAgain' : 'saverapp.hide')}</div>
					</div>
					<div class="sva__pos">{(viewer || 0) + 1} / {list.length}{onTv(viewed) && !viewed.video ? ' · ' + tt('saverapp.onTvToday') : ''} · {tt('saverapp.keysViewer')}</div>
				</div>
			)}
		</div>
	);
}
