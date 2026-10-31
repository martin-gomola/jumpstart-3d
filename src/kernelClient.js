// Talks to the geometry worker; caches meshes by body key.
export class KernelClient {
  constructor({ parts, workerUrl, workerType, onReady, onProgress, onResults, onFail }) {
    Object.assign(this, { parts, workerUrl, workerType, onReady, onProgress, onResults, onFail });
    this.meshes = new Map(); // key -> {ok, mesh|error}
    this.queue = new Map(); // key -> {id,key,node}
    this.inflight = null;
    this.ready = false;
    this.bad = new Set();
    this.req = 0;
    this.stepWaiters = new Map();
    this.assets = new Map(); // imported files (STL/STEP), sent to the worker once
  }
  hasAsset(id) { return this.assets.has(id); }
  addAsset(id, kind, bytes) {
    if (this.assets.has(id)) return;
    this.assets.set(id, { kind, bytes });
    if (this.ready) this.sendAsset(id);
  }
  sendAsset(id) {
    const a = this.assets.get(id);
    const copy = a.bytes.slice().buffer;
    this.worker.postMessage({ type: "asset", id, kind: a.kind, bytes: copy }, [copy]);
  }
  start() {
    this.ready = false;
    this.worker = new Worker(this.workerUrl, this.workerType === "classic" ? {} : { type: "module" });
    this.worker.onmessage = (ev) => this.handle(ev.data);
    this.worker.onerror = (e) => { this.onFail && this.onFail(e.message || "The geometry engine failed to start"); };
    this.worker.postMessage({ type: "init", parts: this.parts });
  }
  handle(msg) {
    if (msg.type === "progress") this.onProgress && this.onProgress(msg);
    else if (msg.type === "ready") { this.ready = true; for (const id of this.assets.keys()) this.sendAsset(id); this.onReady && this.onReady(); this.pump(); }
    else if (msg.type === "built") {
      clearTimeout(this.watchdog);
      for (const r of msg.results) {
        r.key = r.rev;
        delete r.rev;
        this.meshes.set(r.key, r);
        if (this.meshes.size > 160) this.meshes.delete(this.meshes.keys().next().value);
      }
      this.inflight = null;
      this.onResults && this.onResults(msg.results);
      this.pump();
    } else if (msg.type === "step") {
      const w = this.stepWaiters.get(msg.req);
      this.stepWaiters.delete(msg.req);
      w && w.resolve(msg.data);
    } else if (msg.type === "error") {
      const w = this.stepWaiters.get(msg.req);
      if (w) { this.stepWaiters.delete(msg.req); w.reject(new Error(msg.error)); return; }
      if (!this.ready) { this.onFail && this.onFail(msg.error); return; }
      clearTimeout(this.watchdog);
      const items = this.inflight || [];
      this.inflight = null;
      const res = items.map((b) => ({ id: b.id, key: b.key, ok: false, error: msg.error }));
      res.forEach((r) => this.meshes.set(r.key, r));
      this.onResults && this.onResults(res);
      this.pump();
    }
  }
  has(key) { return this.meshes.has(key); }
  get(key) { return this.meshes.get(key); }
  isPending(key) { return this.queue.has(key) || (this.inflight || []).some((b) => b.key === key); }
  request(items) {
    for (const it of items) {
      if (this.meshes.has(it.key) || this.isPending(it.key)) continue;
      if (this.bad.has(it.key)) {
        const r = { id: it.id, key: it.key, ok: false, error: "This shape stalled the geometry engine. Undo the last change or adjust its values." };
        this.meshes.set(it.key, r);
        continue;
      }
      this.queue.set(it.key, it);
    }
    this.pump();
  }
  // drop queued work nobody needs any more
  prune(neededKeys) {
    for (const k of [...this.queue.keys()]) if (!neededKeys.has(k)) this.queue.delete(k);
  }
  pump() {
    if (!this.ready || this.inflight || !this.queue.size) return;
    // send small batches so the screen updates progressively
    // Imported meshes, face patterns, 3D Sketch tubes, large feature trees and large groups
    // run alone so they cannot push several expensive requests past the request time limit.
    const heavy = (it) => { const node = it.node; if (node && node.t === "group" && (node.children || []).length > 40) return true; const j = JSON.stringify(node); return j.length > 40000 || j.includes('"asset"') || j.includes('"t":"facepat"') || j.includes('"logs":true') || (j.includes('"pipe"') && (j.includes('"bez"') || j.includes('"bsp"'))); };
    const batch = [];
    for (const [k, it] of this.queue) {
      if (batch.length && (heavy(it) || heavy(batch[0]))) break;
      batch.push(it); this.queue.delete(k);
      if (batch.length >= 4 || heavy(it)) break;
    }
    this.inflight = batch;
    const req = ++this.req;
    this.worker.postMessage({ type: "build", req, bodies: batch.map((b) => ({ id: b.id, rev: b.key, node: b.node })) });
    // map results back by rev = key
    clearTimeout(this.watchdog);
    // imported meshes take longer to turn into solids: give them more time
    const slow = batch.some(heavy);
    this.watchdog = setTimeout(() => this.stalled(batch), slow ? 120000 : 25000);
    this.onBusy && this.onBusy(true);
  }
  stalled(batch) {
    // OpenCascade occasionally loops forever on extreme fillets; restart the worker.
    try { this.worker.terminate(); } catch (e) {}
    const res = batch.map((b) => {
      this.bad.add(b.key);
      return { id: b.id, key: b.key, ok: false, error: "This shape stalled the geometry engine. Undo the last change or adjust its values." };
    });
    res.forEach((r) => this.meshes.set(r.key, r));
    this.inflight = null;
    this.onResults && this.onResults(res);
    this.start();
  }
  // A temporary worker bounds native query time without interrupting builds, STEP exports, or cache ownership.
  inspectPairs(pairs, { timeoutMs = 20000 } = {}) {
    if (!Array.isArray(pairs) || !pairs.length || pairs.length > 8) return Promise.reject(new Error("Pair inspection requires 1 to 8 pairs"));
    return new Promise((resolve) => {
      let worker, timer, finished = false;
      const unknown = (error) => pairs.map(({ id }) => ({ id, status: "unknown", error, distanceMm: null, overlapVolumeMm3: null, physicalFit: "unverified" }));
      const finish = (results) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker?.terminate();
        resolve(results);
      };
      try {
        worker = new Worker(this.workerUrl, this.workerType === "classic" ? {} : { type: "module" });
        timer = setTimeout(() => finish(unknown("Native pair inspection timed out; reduce query complexity and inspect again")), timeoutMs);
        worker.onerror = () => finish(unknown("Native pair inspection worker failed"));
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") {
            const assetIds = new Set();
            const nativePairs = pairs.filter((pair) => { let mesh = false; JSON.stringify(pair, (key, value) => { if (key === "t" && value === "mesh") mesh = true; return value; }); return !mesh; });
            JSON.stringify(nativePairs, (key, value) => { if (key === "asset" && typeof value === "string") assetIds.add(value); return value; });
            for (const id of assetIds) {
              const asset = this.assets.get(id);
              if (!asset) { finish(unknown("Pair inspection asset is unavailable")); return; }
              const bytes = asset.bytes.slice().buffer;
              worker.postMessage({ type: "asset", id, kind: asset.kind, bytes }, [bytes]);
            }
            worker.postMessage({ type: "inspectPairs", req: 1, pairs });
          } else if (data.type === "inspectedPairs") finish(data.results);
          else if (data.type === "error") finish(unknown(data.error || "Native pair inspection failed"));
        };
        worker.postMessage({ type: "init", parts: this.parts });
      } catch (error) { finish(unknown(error.message || "Could not start pair inspection worker")); }
    });
  }
  // Hidden-line projections for drawings, isolated like inspectPairs.
  project(bodies, cameras, { hidden = true, timeoutMs = 45000 } = {}) {
    return new Promise((resolve, reject) => {
      let worker, timer, finished = false;
      const finish = (error, views) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker?.terminate();
        error ? reject(new Error(error)) : resolve(views);
      };
      try {
        worker = new Worker(this.workerUrl, this.workerType === "classic" ? {} : { type: "module" });
        timer = setTimeout(() => finish("Drawing projection timed out; draw fewer or simpler bodies"), timeoutMs);
        worker.onerror = () => finish("Drawing projection worker failed");
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") {
            const assetIds = new Set();
            JSON.stringify(bodies, (key, value) => { if (key === "asset" && typeof value === "string") assetIds.add(value); return value; });
            for (const id of assetIds) {
              const asset = this.assets.get(id);
              if (!asset) { finish("A drawing asset is unavailable"); return; }
              const bytes = asset.bytes.slice().buffer;
              worker.postMessage({ type: "asset", id, kind: asset.kind, bytes }, [bytes]);
            }
            worker.postMessage({ type: "project", req: 1, bodies, cameras, options: { hidden } });
          } else if (data.type === "projected") finish(null, data.views);
          else if (data.type === "error") finish(data.error || "Drawing projection failed");
        };
        worker.postMessage({ type: "init", parts: this.parts });
      } catch (error) { finish(error.message || "Could not start the drawing projection worker"); }
    });
  }
  step(bodies) {
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      this.stepWaiters.set(req, { resolve, reject });
      this.worker.postMessage({ type: "step", req, bodies });
    });
  }
}
