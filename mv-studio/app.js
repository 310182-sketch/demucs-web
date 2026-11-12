import { TRACKS, SAMPLE_RATE, mixStems, wavBlob } from './audio-utils.js';
const $ = s => document.querySelector(s), video = $('#video'), audio = $('#audio');
const names = { drums: '鼓組', bass: '貝斯', other: '其他', vocals: '人聲' };
let file, mediaUrl, worker, modelReady = false, busy = false, stems, ctx;
let pitch = 0, buffers = {}, sources = [], gains = {}, master, started = 0, offset = 0, playing = false;
let recording = false, recorder, cancelRecording = false, duration = 0, generation = 0, transportEpoch = 0;
const levels = { drums: 1, bass: 1, other: 1, vocals: 0 };
const engine = text => $('#engine-status').textContent = text;
const message = text => $('#message').textContent = text;
const rate = () => 2 ** (pitch / 12);
const hasVideo = () => file?.type.startsWith('video/');
const time = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
function controls() {
  $('#separate').disabled = !file || !modelReady || busy || recording;
  $('#load-model').disabled = modelReady || busy || recording;
  $('#clear').disabled = busy || recording;
  $('#cancel').classList.toggle('hidden', !busy);
  $('#file').disabled = busy || recording;
  $('#import-stems').disabled = !file || busy || recording;
  for (const id of ['play','download','key-down','key-up','seek','preset-karaoke','preset-original','loop']) $(`#${id}`).disabled = !stems || busy || recording;
  $('#download-video').disabled = !stems || !hasVideo() || busy || recording || !window.MediaRecorder;
  $('#cancel-export').classList.toggle('hidden', !recording);
  document.querySelectorAll('[data-gain], [data-stem], [data-solo]').forEach(el => el.disabled = !stems || busy || recording);
}
function getContext() {
  if (!ctx) { ctx = new AudioContext({ sampleRate: SAMPLE_RATE }); master = ctx.createGain(); master.connect(ctx.destination); }
  return ctx;
}
function position() { return Math.min(duration, offset + (playing ? (ctx.currentTime - started) * rate() : 0)); }
function stop() {
  transportEpoch++;
  if (playing) offset = position(); playing = false;
  for (const source of sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
  sources = []; for (const gain of Object.values(gains)) gain.disconnect(); gains = {};
  video.pause(); $('#play').textContent = '▶'; $('#play').setAttribute('aria-label','播放');
}
async function start() {
  if (!stems) return;
  const epoch = ++transportEpoch;
  getContext(); await ctx.resume(); if(epoch !== transportEpoch || !stems) return;
  if (offset >= duration - .05) offset = 0;
  if (hasVideo()) {
    video.currentTime = offset; video.playbackRate = rate(); video.muted = true;
    try { await video.play(); } catch (e) { message('影片無法播放：' + e.message); return; }
  }
  if(epoch !== transportEpoch || !stems) return;
  started = ctx.currentTime;
  for (const key of TRACKS) {
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffers[key]; source.playbackRate.value = rate(); gain.gain.value = levels[key];
    source.connect(gain).connect(master); source.start(started, offset); sources.push(source); gains[key] = gain;
  }
  playing = true; $('#play').textContent = 'Ⅱ'; $('#play').setAttribute('aria-label','暫停');
}
function resetResult() {
  stop(); stems = null; buffers = {}; offset = duration = pitch = 0;
  $('#key-value').value = '0'; $('#seek').value = 0; $('#time').textContent = '0:00 / 0:00';
  for (const key of TRACKS) { $(`#stem-${key}`).classList.remove('ready'); $(`#stem-${key} small`).textContent = '等待分離'; }
  $('#progress-wrap').classList.add('hidden'); $('#playing-sub').textContent = '上傳媒體並完成分離後開始播放'; controls();
}
function showFile(next) {
  if (busy || recording) return;
  if (!/^(video|audio)\//.test(next.type)) { message('請選擇可播放的影片或音訊檔。'); return; }
  generation++; resetResult(); audio.pause(); video.pause(); if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  file = next; mediaUrl = URL.createObjectURL(file);
  for (const media of [video,audio]) { media.removeAttribute('src'); media.load(); }
  video.classList.toggle('hidden', !hasVideo()); audio.classList.toggle('hidden', hasVideo());
  video.controls = true; video.muted = false; video.playbackRate = 1;
  (hasVideo() ? video : audio).src = mediaUrl;
  $('#drop').classList.add('hidden'); $('#preview-wrap').classList.remove('hidden');
  $('#filename').textContent = file.name; $('#playing-title').textContent = file.name; message(''); controls();
}
$('#file').onchange = e => e.target.files[0] && showFile(e.target.files[0]);
$('#clear').onclick = () => {
  generation++; resetResult(); audio.pause(); file = null;
  for (const media of [audio,video]) { media.removeAttribute('src'); media.load(); }
  if (mediaUrl) URL.revokeObjectURL(mediaUrl); mediaUrl = null;
  $('#file').value = ''; $('#preview-wrap').classList.add('hidden'); $('#drop').classList.remove('hidden');
  $('#playing-title').textContent = '尚未選擇音軌'; message(''); controls();
};
$('#drop').ondragover = e => { e.preventDefault(); $('#drop').classList.add('drag'); };
$('#drop').ondragleave = () => $('#drop').classList.remove('drag');
$('#drop').ondrop = e => { e.preventDefault(); $('#drop').classList.remove('drag'); if (e.dataTransfer.files[0]) showFile(e.dataTransfer.files[0]); };
function createWorker() {
  worker = new Worker(new URL('./separator-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({data}) => {
    if (data.type === 'status') engine(data.text);
    if (data.type === 'ready') { modelReady = true; busy = false; engine('模型已就緒 · 本機運算'); controls(); }
    if (data.type === 'progress') {
      const pct = Math.min(99, Math.round(data.progress * 100));
      $('#progress').style.width = pct + '%'; $('#progress-pct').textContent = pct + '%';
      $('#progress-label').textContent = `正在分析第 ${data.currentSegment} 段…`;
    }
    if (data.type === 'result') { busy = false; installStems(data.stems); }
    if (data.type === 'error') fail(data.message);
  };
  worker.onerror = e => fail(e.message || '分離程序意外停止，請重試');
}
function fail(text) {
  busy = false; modelReady = false; worker?.terminate(); worker = null;
  engine('處理失敗，可重新載入'); message(text); controls();
}
$('#load-model').onclick = () => {
  busy = true; controls(); message(''); engine('下載模型約 172 MB，首次載入請稍候…');
  createWorker(); worker.postMessage({ type: 'load' });
};
$('#cancel').onclick = () => {
  generation++; worker?.terminate(); worker = null; busy = modelReady = false;
  engine('已取消，重新載入模型即可再試'); message('處理已取消'); controls();
};
$('#separate').onclick = async () => {
  const token = generation; busy = true; stop(); audio.pause(); video.pause(); controls(); message('');
  $('#progress-wrap').classList.remove('hidden'); $('#progress').style.width = '0%';
  $('#progress-pct').textContent = '0%'; $('#progress-label').textContent = '解碼音訊…';
  try {
    const decoded = await getContext().decodeAudioData(await file.arrayBuffer()); if (token !== generation) return;
    const offline = new OfflineAudioContext(2, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const resampled = await offline.startRendering(); if (token !== generation) return;
    const left = resampled.getChannelData(0).slice(), right = resampled.getChannelData(1).slice();
    $('#progress-label').textContent = 'AI 分離中，請保留此分頁…';
    worker.postMessage({type:'separate',left,right},[left.buffer,right.buffer]);
  } catch(e) { if (token === generation) { busy = false; message('音訊解碼失敗：'+e.message); controls(); } }
};
$('#import-stems').onchange = async e => {
  const files = [...e.target.files], token = generation;
  if (!TRACKS.every(key=>files.some(f=>f.name.toLowerCase()===`${key}.wav`))) { message('請一次選取 drums.wav、bass.wav、other.wav、vocals.wav 四個檔案。'); return; }
  busy = true; controls(); stop();
  try {
    const imported = {};
    for (const key of TRACKS) {
      const buffer = await getContext().decodeAudioData(await files.find(f=>f.name.toLowerCase()===`${key}.wav`).arrayBuffer());
      if(buffer.sampleRate !== SAMPLE_RATE) throw new Error('四軌需使用 44.1 kHz WAV。');
      imported[key] = {left:buffer.getChannelData(0).slice(),right:buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1)).slice()};
    }
    if(!TRACKS.every(key=>imported[key].left.length===imported.drums.left.length)) throw new Error('四軌的長度需一致。');
    if(token !== generation) return;
    installStems(imported); message('已匯入四軌，可直接混音與匯出。');
  } catch(error) { message('匯入失敗：'+error.message); }
  finally { busy=false;controls();e.target.value=''; }
};
function installStems(result) {
  stop(); stems = result; getContext(); duration = stems.drums.left.length / SAMPLE_RATE; offset = 0;
  for (const key of TRACKS) {
    const buffer = ctx.createBuffer(2, stems[key].left.length, SAMPLE_RATE);
    buffer.copyToChannel(stems[key].left,0); buffer.copyToChannel(stems[key].right,1); buffers[key] = buffer;
    $(`#stem-${key}`).classList.add('ready'); $(`#stem-${key} small`).textContent = '已完成';
  }
  video.pause(); audio.pause(); audio.classList.add('hidden'); video.muted = true; video.controls = false;
  $('#progress').style.width = '100%'; $('#progress-pct').textContent = '100%'; $('#progress-label').textContent = '四軌分離完成';
  $('#playing-title').textContent = '伴奏混音'; $('#playing-sub').textContent = '影片已切換為伴奏，使用下方播放台控制';
  $('#seek').max = duration; setLevels({drums:1,bass:1,other:1,vocals:0}); controls();
}
function setLevels(values) {
  Object.assign(levels,values);
  for (const key of TRACKS) {
    const input = $(`[data-gain="${key}"]`); input.value = levels[key] * 100; input.nextElementSibling.value = `${Math.round(levels[key]*100)}%`;
    if(gains[key]) gains[key].gain.setTargetAtTime(levels[key],ctx.currentTime,.015);
  }
}
for (const key of TRACKS) {
  $('#stems').insertAdjacentHTML('beforeend',`<div class="stem" id="stem-${key}"><b>${key[0].toUpperCase()}</b><span>${names[key]}</span><small>等待分離</small><button class="text-button" data-stem="${key}" disabled>↓ WAV</button></div>`);
  $('#mixers').insertAdjacentHTML('beforeend',`<div class="mix-row"><label for="gain-${key}">${names[key]}</label><input id="gain-${key}" data-gain="${key}" aria-label="${names[key]}音量" type="range" min="0" max="100" value="${levels[key]*100}" disabled><output>${levels[key]*100}%</output><button class="text-button" data-solo="${key}" disabled>獨聽</button></div>`);
  $(`[data-gain="${key}"]`).oninput = e => setLevels({[key]:Number(e.target.value)/100});
  $(`[data-solo="${key}"]`).onclick = () => setLevels(Object.fromEntries(TRACKS.map(k=>[k,k===key?1:0])));
  $(`[data-stem="${key}"]`).onclick = () => save(wavBlob(stems[key].left,stems[key].right),`${key}.wav`);
}
$('#preset-karaoke').onclick = () => setLevels({drums:1,bass:1,other:1,vocals:0});
$('#preset-original').onclick = () => setLevels({drums:1,bass:1,other:1,vocals:1});
$('#play').onclick = () => playing ? stop() : start().catch(e=>message(e.message));
$('#seek').oninput = async e => { const resume = playing; stop(); offset = Number(e.target.value); if(hasVideo()) video.currentTime = offset; if(resume) await start(); };
async function setPitch(value) {
  const resume = playing; stop(); pitch = Math.max(-6,Math.min(6,value));
  $('#key-value').value = pitch > 0 ? `+${pitch}` : `${pitch}`; video.playbackRate = rate(); if(resume) await start();
}
$('#key-down').onclick = () => setPitch(pitch-1); $('#key-up').onclick = () => setPitch(pitch+1);
function save(blob,name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function renderedMix() {
  const mix = mixStems(stems, levels); if (!pitch) return mix;
  const offline = new OfflineAudioContext(2,Math.ceil(mix.left.length/rate()),SAMPLE_RATE);
  const buffer = offline.createBuffer(2,mix.left.length,SAMPLE_RATE); buffer.copyToChannel(mix.left,0); buffer.copyToChannel(mix.right,1);
  const source = offline.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate(); source.connect(offline.destination); source.start();
  const out = await offline.startRendering(); return {left:out.getChannelData(0),right:out.getChannelData(1)};
}
$('#download').onclick = async () => {
  const token = generation; busy = true; controls();
  try { const mix = await renderedMix(); if(token !== generation) return; save(wavBlob(mix.left,mix.right),`伴奏混音_${pitch > 0 ? '+' : ''}${pitch}key.wav`); message('WAV 已匯出，包含目前音量與音高設定。'); }
  catch(e) {message('匯出失敗：'+e.message);} finally {busy=false;controls();}
};
$('#download-video').onclick = async () => {
  stop(); recording = true; cancelRecording = false; controls(); offset = 0;
  let stream, destination, frame;
  try {
    getContext(); await ctx.resume();
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const draw = canvas.getContext('2d'); video.currentTime = 0;
    if(video.seeking) await new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));
    draw.drawImage(video,0,0,canvas.width,canvas.height); stream = canvas.captureStream(24);
    destination = ctx.createMediaStreamDestination(); master.connect(destination);
    destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
    const mimeType = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mimeType) throw new Error('此瀏覽器不支援 WebM 匯出，請改用 Chrome 或 Edge。');
    const chunks = []; recorder = new MediaRecorder(stream,{mimeType,videoBitsPerSecond:6000000});
    recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=e=>reject(e.error || new Error('影片錄製失敗'));});
    if(cancelRecording) return;
    await start(); if(!playing) throw new Error('影片未開始播放'); if(cancelRecording) return; recorder.start(1000);
    const paint = () => {draw.drawImage(video,0,0,canvas.width,canvas.height);frame=requestAnimationFrame(paint);}; paint();
    message('正在匯出 MV，請保持此分頁在前景。匯出時間約等於播放長度。'); await done;
    if(!cancelRecording) { save(new Blob(chunks,{type:mimeType}),'伴奏MV.webm'); message('伴奏 MV 已匯出。'); }
  } catch(e) {message('MV 匯出失敗：'+e.message);}
  finally {
    if(recorder?.state === 'recording') recorder.stop(); cancelAnimationFrame(frame); stop(); offset = 0;
    if(destination) master.disconnect(destination); stream?.getTracks().forEach(track=>track.stop());
    recorder = null; recording = false; controls();
  }
};
$('#cancel-export').onclick = () => { cancelRecording = true; if(recorder?.state==='recording') recorder.stop(); message('已取消匯出'); };
document.addEventListener('visibilitychange',()=>{if(document.hidden && recording) $('#cancel-export').click();});
setInterval(()=>{
  const current = position(); $('#time').textContent = `${time(current)} / ${time(duration)}`; $('#seek').value = current;
  if(playing && current >= duration-.03) {
    if(recording && recorder?.state==='recording') recorder.stop();
    stop(); if(!recording && $('#loop').checked) {offset=0;start();}
  }
  if(playing && hasVideo() && !recording && Math.abs(video.currentTime-current)>.2) video.currentTime=current;
},100);
controls();
