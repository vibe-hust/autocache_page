const methods = [
  ['original', 'Original'], ['autocache', 'AutoCache'], ['teacache', 'TeaCache', 'CVPR 2025'],
  ['dicache', 'DiCache', 'ICLR 2026'], ['seacache', 'SeaCache', 'CVPR 2026'],
];

const imageFocus = {
  guitars: 'Zoom in on the left guitar and compare the pickups and bridge.',
  zebra: 'Zoom in where the violin meets the zebra and compare the bow and stripes.',
  drawbench_0195: 'Zoom in on the fireworks and check whether the letters in “Diffusion” stay legible.',
  drawbench_0004: 'Zoom in on the ear at the left and compare its outline.',
  drawbench_0107: 'Zoom in on the cabinet to the left of the refrigerator and compare the handles.',
};

const paperCases = [
  {
    id: 'astronaut', kind: 'video', title: 'Astronaut near Earth',
    prompt: 'An astronaut flying in space, zoom in', model: 'Wan2.1-T2V-1.3B · VBench',
    time: '5 s',
  },
  {
    id: 'skier', kind: 'video', title: 'Skier on the slope',
    prompt: 'skis on the bottom of a snowboard, front view', model: 'Wan2.1-T2V-1.3B · VBench',
    time: '3.25 s',
  },
  {
    id: 'guitars', kind: 'image', title: 'Guitars and suitcases',
    prompt: 'three guitars and two brown suitcases', model: 'Qwen-Image-2.1 · GenEval 2',
    hotspot: { label: 'Guitar body and hardware', box: [4.3, 57.62, 30.47, 22.85] },
  },
  {
    id: 'zebra', kind: 'image', title: 'Violin and zebra',
    prompt: 'a sparkling violin on top of a zebra, and a truck', model: 'Qwen-Image-2.1 · GenEval 2',
    hotspot: { label: 'Violin outline and zebra stripes', box: [7.42, 49.22, 28.12, 28.12] },
  },
];

const tileTemplate = document.querySelector('#tile-template');

function paperSources(scene) {
  return Object.fromEntries(methods.map(([key]) => [key, {
    image: `assets/paper/${scene.id}/${key}.webp`,
  }]));
}

function makeTile(scene, [key, name, source, venue], zoomed = false) {
  const tile = tileTemplate.content.firstElementChild.cloneNode(true);
  const visual = tile.querySelector('.visual');
  const label = source.label ?? name;
  const difference = `assets/differences/${scene.id}/${key}`;
  const reference = key === 'original';
  const caption = tile.querySelector('.method-name');
  caption.textContent = label;
  if (venue) {
    const conference = document.createElement('small');
    conference.textContent = venue;
    caption.append(conference);
  }
  if (source.video) {
    const video = document.createElement('video');
    video.src = `${difference}${zoomed ? '-detail' : ''}.mp4`;
    video.preload = 'metadata';
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-label', `${scene.title} · ${label} with difference map underneath`);
    visual.append(video);
  } else {
    const image = new Image();
    image.src = source.image;
    image.alt = `${scene.title} · ${label}`;
    image.loading = 'lazy';
    visual.append(image);
    const map = document.createElement('div');
    map.className = 'difference-map';
    if (reference) {
      map.classList.add('reference-map');
      map.setAttribute('role', 'img');
      map.setAttribute('aria-label', 'Original compared with itself: zero difference');
    } else {
      const heatmap = new Image();
      heatmap.src = `${difference}.webp`;
      heatmap.alt = `${scene.title} · ${label} pixel difference from Original`;
      heatmap.loading = 'lazy';
      map.append(heatmap);
    }
    tile.append(map);
  }
  return tile;
}

function observeViewportVisibility(topInset, threshold, onVisibilityChange) {
  return new IntersectionObserver(entries => {
    for (const { target, intersectionRatio } of entries) {
      onVisibilityChange(target, intersectionRatio >= threshold);
    }
  }, { rootMargin: `-${topInset}px 0px 0px`, threshold });
}

function setVideoPlayback(video, visible) {
  if (visible) video.play().catch(() => {});
  else video.pause();
}

function comparisonEntries(scene) {
  return methods.map(([key, name, venue]) => [key, name, scene.methods[key], venue])
    .filter(([, , source]) => source?.image || source?.video);
}

function formatVideoTime(seconds) {
  const ticks = Math.round(seconds * 100);
  return `${Math.floor(ticks / 6000)}:${((ticks % 6000) / 100).toFixed(2).padStart(5, '0')}`;
}

function bindComparisonTimeline(panel, videos, { startTime = 0, autoplay = false, loop = false } = {}) {
  const controls = panel.querySelector('.video-controls');
  const status = panel.querySelector('.video-status');
  const [leader] = videos;
  controls.hidden = !leader;
  status.hidden = true;
  if (!leader) return undefined;

  const button = panel.querySelector('.play');
  const slider = panel.querySelector('.video-seek');
  const timeReadout = panel.querySelector('.video-time');
  const events = new AbortController();
  const options = { signal: events.signal };
  const groupSeekTargets = new WeakMap();
  let duration = 0;
  let playing = false;
  let request = 0;
  let autoplayPending = autoplay;
  let pendingTime = startTime;

  function updateTime() {
    const current = Math.min(leader.currentTime, duration);
    const label = `${formatVideoTime(current)} / ${formatVideoTime(duration)}`;
    slider.value = String(current);
    slider.setAttribute('aria-valuetext', label);
    timeReadout.textContent = label;
  }

  function updateDuration() {
    const durations = videos.map(video => video.duration);
    duration = durations.every(value => Number.isFinite(value) && value > 0) ? Math.min(...durations) : 0;
    slider.max = String(duration || 1);
    button.disabled = slider.disabled = duration === 0;
    if (duration > 0 && pendingTime > 0) {
      seekAll(Math.min(pendingTime, duration));
      pendingTime = 0;
    } else {
      updateTime();
    }
    if (autoplayPending && duration > 0) {
      autoplayPending = false;
      playAll();
    }
  }

  function leaveGroupPlayback() {
    request += 1;
    playing = false;
    button.textContent = 'Play all';
  }

  function pauseAll() {
    leaveGroupPlayback();
    videos.forEach(video => video.pause());
  }

  function seekVideo(video, time) {
    if (video.currentTime === time) return;
    groupSeekTargets.set(video, time);
    video.currentTime = time;
  }

  function seekAll(time) {
    videos.forEach(video => seekVideo(video, time));
    updateTime();
  }

  function seekTogether(time) {
    pauseAll();
    seekAll(time);
  }

  function showPlaybackError() {
    if (playing) pauseAll();
    status.textContent = 'One or more comparison clips could not be played.';
    status.hidden = false;
  }

  async function playAll() {
    if (playing) return;
    status.hidden = true;
    const currentRequest = ++request;
    seekAll(leader.ended || leader.currentTime >= duration ? 0 : leader.currentTime);
    playing = true;
    button.textContent = 'Pause all';
    const results = await Promise.allSettled(videos.map(video => video.play()));
    if (currentRequest === request && results.some(result => result.status === 'rejected')) showPlaybackError();
  }

  function finishPlayback() {
    pauseAll();
    seekAll(loop ? 0 : duration);
    if (loop) playAll();
  }

  button.addEventListener('click', () => {
    if (playing) pauseAll();
    else playAll();
  }, options);

  slider.addEventListener('input', () => seekTogether(slider.valueAsNumber), options);

  leader.addEventListener('timeupdate', () => {
    const time = leader.currentTime;
    if (playing && !leader.seeking && time >= duration) {
      finishPlayback();
      return;
    }
    if (playing && !leader.seeking) {
      for (const video of videos.slice(1)) {
        if (!video.seeking && Math.abs(video.currentTime - time) > 0.08) seekVideo(video, time);
      }
    }
    updateTime();
  }, options);
  leader.addEventListener('ended', () => {
    if (playing && leader.ended) finishPlayback();
  }, options);
  for (const video of videos) {
    video.addEventListener('pause', () => {
      if (playing && video.paused && !video.ended) leaveGroupPlayback();
    }, options);
    video.addEventListener('seeking', () => {
      if (playing && video.currentTime !== groupSeekTargets.get(video)) leaveGroupPlayback();
    }, options);
    video.addEventListener('seeked', () => groupSeekTargets.delete(video), options);
    video.addEventListener('loadedmetadata', updateDuration, options);
    video.addEventListener('error', showPlaybackError, options);
  }
  pauseAll();
  updateDuration();

  return {
    get playback() {
      const active = videos.find(video => !video.paused && !video.ended);
      return {
        startTime: pendingTime || (active ?? leader).currentTime,
        autoplay: autoplayPending || Boolean(active),
      };
    },
    setVisible(visible) {
      autoplayPending = visible && duration === 0;
      if (!visible) pauseAll();
      else if (!autoplayPending) playAll();
    },
    dispose() {
      events.abort();
      pauseAll();
    },
  };
}

function bindSceneSwitcher(gallery, panel, examples, renderScene) {
  gallery.hidden = examples.length === 0;
  if (gallery.hidden) return;

  const switcher = gallery.querySelector('.scene-switcher');
  const previous = panel.querySelector('.carousel-prev');
  const next = panel.querySelector('.carousel-next');
  let selected = -1;
  const buttons = examples.map((scene, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = scene.title;
    button.setAttribute('aria-label', scene.title);
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', () => showScene(index));
    return button;
  });
  switcher.append(...buttons);
  previous.hidden = next.hidden = examples.length < 2;
  previous.addEventListener('click', () => showScene((selected + examples.length - 1) % examples.length));
  next.addEventListener('click', () => showScene((selected + 1) % examples.length));

  function showScene(index) {
    if (index === selected) return;
    selected = index;
    buttons.forEach((button, position) => button.setAttribute('aria-pressed', String(position === index)));
    renderScene(examples[index]);
  }

  showScene(0);
}

function renderVideoGallery(scenes) {
  const gallery = document.querySelector('#video-gallery');
  const examples = scenes.filter(scene => scene.kind === 'video' && comparisonEntries(scene).length);
  const skierIndex = examples.findIndex(scene => scene.id === 'vbench_0938' || scene.id === 'skier');
  if (skierIndex > 0) examples.unshift(examples.splice(skierIndex, 1)[0]);

  const panel = gallery.querySelector('#video-comparison');
  const row = panel.querySelector('.comparison');
  const zoom = panel.querySelector('.comparison-zoom');
  const zoomLabel = zoom.querySelector('span');

  function loadClips(scene, { expanded = false, startTime = 0, autoplay = false } = {}) {
    comparisonTimeline?.dispose();
    panel.classList.toggle('is-zoomed', expanded);
    zoomLabel.textContent = expanded ? 'Reset view' : 'Zoom in';
    row.replaceChildren(...comparisonEntries(scene).map(entry => makeTile(scene, entry, expanded)));
    comparisonTimeline = bindComparisonTimeline(panel, [...row.querySelectorAll('video')], {
      startTime, autoplay, loop: expanded,
    });
  }

  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel.classList.contains('is-zoomed')) zoom.click();
  });

  bindSceneSwitcher(gallery, panel, examples, scene => {
    panel.querySelector('.prompt').textContent = `“${scene.prompt}”`;
    const detail = scene.videoDetail;
    zoom.hidden = !detail;
    const detailHint = detail?.label ?? '';
    zoom.title = detailHint;
    zoom.onclick = detail ? () => {
      const expanded = panel.classList.contains('is-zoomed');
      const { startTime, autoplay } = comparisonTimeline.playback;
      loadClips(scene, { expanded: !expanded, startTime, autoplay: !expanded || autoplay });
      zoom.title = expanded ? detailHint : 'Restore full frame';
    } : null;
    loadClips(scene);
    row.scrollLeft = 0;
    if (comparisonInView) comparisonTimeline?.setVisible(true);
  });
}

function renderImageGallery(scenes) {
  const gallery = document.querySelector('#image-gallery');
  const examples = scenes.filter(scene => scene.kind === 'image' && comparisonEntries(scene).length);
  const panel = gallery.querySelector('#image-comparison');
  const row = panel.querySelector('.comparison');
  const focus = panel.querySelector('.scene-focus');
  const zoom = panel.querySelector('.comparison-zoom');
  const zoomLabel = zoom.querySelector('span');

  function setZoom(expanded) {
    panel.classList.toggle('is-zoomed', expanded);
    zoomLabel.textContent = expanded ? 'Reset view' : 'Zoom in';
  }

  zoom.addEventListener('click', () => setZoom(!panel.classList.contains('is-zoomed')));
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') setZoom(false);
  });

  bindSceneSwitcher(gallery, panel, examples, scene => {
    panel.querySelector('.prompt').textContent = `“${scene.prompt}”`;
    setZoom(false);
    zoom.hidden = !scene.hotspot;
    zoom.title = scene.hotspot?.label ?? '';
    if (scene.hotspot) {
      const [left, top, width, height] = scene.hotspot.box;
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      row.style.setProperty('--zoom-origin', `${centerX}% ${centerY}%`);
      row.style.setProperty('--zoom-transform', `translate(${50 - centerX}%, ${50 - centerY}%) scale(${100 / Math.min(width, height)})`);
    }
    row.replaceChildren(...comparisonEntries(scene).map(entry => makeTile(scene, entry)));
    row.scrollLeft = 0;
    const [model, benchmark] = scene.model?.split(' · ', 2) ?? [];
    panel.querySelector('.case-note').textContent =
      [model, benchmark?.replace(/ (evaluation|exploration)$/, '')].filter(Boolean).join(' · ');
    focus.textContent = imageFocus[scene.id] ?? '';
    focus.hidden = !focus.textContent;
  });
}

const methodVideo = document.querySelector('#method-video');
const siteHeader = document.querySelector('.site-header');
const comparisonGrid = document.querySelector('#comparison-videos');
let contentPlayback;
let comparisonTimeline;
let comparisonInView = false;
let methodInView = false;
function updateViewportLayout() {
  const headerHeight = siteHeader.offsetHeight;
  document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
  contentPlayback?.disconnect();
  contentPlayback = observeViewportVisibility(headerHeight, 0.25, (target, visible) => {
    if (target === methodVideo && methodInView !== visible) {
      methodInView = visible;
      setVideoPlayback(methodVideo, visible);
    }
    if (target === comparisonGrid && comparisonInView !== visible) {
      comparisonInView = visible;
      comparisonTimeline?.setVisible(visible);
    }
  });
  contentPlayback.observe(methodVideo);
  contentPlayback.observe(comparisonGrid);
}

const headerLayout = new ResizeObserver(updateViewportLayout);
headerLayout.observe(siteHeader);

const chapterButtons = [...document.querySelectorAll('.method-chapters button')];
let pendingChapter = null;

function seekToMethodChapter() {
  if (pendingChapter === null || methodVideo.readyState < methodVideo.HAVE_METADATA) return;
  methodVideo.currentTime = pendingChapter;
  pendingChapter = null;
}

for (const button of chapterButtons) {
  button.addEventListener('click', () => {
    pendingChapter = Number(button.dataset.start);
    seekToMethodChapter();
    methodVideo.play().catch(() => {});
  });
}

methodVideo.addEventListener('loadedmetadata', seekToMethodChapter);
methodVideo.addEventListener('timeupdate', () => {
  const current = chapterButtons.findLast(button => methodVideo.currentTime >= Number(button.dataset.start));
  for (const button of chapterButtons) {
    if (button === current) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
});

const incoming = new Map(window.autoCacheMedia.map(scene => [scene.id, scene]));
const scenes = paperCases.map(scene => {
  const replacement = incoming.get(scene.id);
  const sources = paperSources(scene);
  for (const [key, source] of Object.entries(replacement?.methods ?? {})) {
    sources[key] = { ...sources[key], ...source };
  }
  incoming.delete(scene.id);
  return { ...scene, ...replacement, methods: sources };
});
scenes.push(...incoming.values());
const selectedVideos = window.autoCacheMedia
  .map(({ id }) => scenes.find(scene => scene.id === id))
  .filter(scene => scene?.kind === 'video');
const videoScenes = selectedVideos.length ? selectedVideos : scenes;
renderVideoGallery(videoScenes);
renderImageGallery(scenes);

document.querySelectorAll('.copy-bibtex').forEach(btn => {
  btn.addEventListener('click', async () => {
    const target = document.getElementById(btn.dataset.copyTarget);
    if (!target) return;
    const text = target.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = prev; }, 1800);
  });
});
