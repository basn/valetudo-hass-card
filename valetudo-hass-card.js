class ValetudoHassCard extends HTMLElement {
  static get VERSION() {
    return "map-cleanup-1";
  }

  static getStubConfig() {
    return {
      type: "custom:valetudo-hass-card",
      vacuum: "vacuum.mantequilla",
    };
  }

  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._mapNonce = null;
    this._mapPayload = null;
    this._mapUrl = null;
    this._mapFetchInFlight = null;
  }

  setConfig(config) {
    if (!config || !config.vacuum) {
      throw new Error("Missing required vacuum entity");
    }

    this._config = config;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    this._syncMapFetch();
    this._safeRender();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncMapFetch();
    this._safeRender();
  }

  getCardSize() {
    return 7;
  }

  _state(entityId) {
    if (!this._hass || !this._hass.states) {
      return undefined;
    }
    return this._hass.states[entityId];
  }

  _callService(domain, service) {
    if (!this._hass || !this._config || !this._config.vacuum) {
      return;
    }

    this._hass.callService(domain, service, { entity_id: this._config.vacuum });
  }

  _syncMapFetch() {
    const vacuum = this._state(this._config && this._config.vacuum);
    if (!vacuum || !vacuum.attributes) {
      return;
    }

    const nextUrl = vacuum.attributes.map_data_url;
    const nextNonce = vacuum.attributes.map_nonce || "unknown";

    if (!nextUrl) {
      return;
    }

    if (this._mapUrl !== nextUrl) {
      this._mapUrl = nextUrl;
      this._mapPayload = null;
      this._mapNonce = null;
    }

    if (this._mapNonce === nextNonce || this._mapFetchInFlight) {
      return;
    }

    const fetchWithAuth =
      this._hass &&
      (
        (typeof this._hass.fetchWithAuth === "function" && this._hass.fetchWithAuth.bind(this._hass)) ||
        (this._hass.auth && typeof this._hass.auth.fetchWithAuth === "function" && this._hass.auth.fetchWithAuth.bind(this._hass.auth))
      );

    const request = fetchWithAuth
      ? fetchWithAuth(nextUrl)
      : fetch(nextUrl, { credentials: "same-origin" });

    this._mapFetchInFlight = request
      .then((response) => {
        if (!response.ok) {
          throw new Error("Map request failed: " + response.status);
        }
        return response.json();
      })
      .then((payload) => {
        this._mapPayload = payload;
        this._mapNonce = nextNonce;
        this._safeRender();
      })
      .catch((err) => {
        console.error("valetudo-hass-card map fetch failed", err);
        this._mapPayload = {
          error: this._formatError(err),
        };
        this._safeRender();
      })
      .finally(() => {
        this._mapFetchInFlight = null;
      });
  }

  _formatError(err) {
    if (!err) {
      return "unknown error";
    }
    if (typeof err === "string") {
      return err;
    }
    if (err.message) {
      return err.message;
    }
    if (err.body && typeof err.body === "string") {
      return err.body;
    }
    try {
      return JSON.stringify(err);
    } catch (_jsonErr) {
      return String(err);
    }
  }

  _renderError(err) {
    if (!this.shadowRoot) {
      return;
    }
    const message = err && err.message ? err.message : String(err);
    this.shadowRoot.innerHTML = this.styles() + `
      <ha-card>
        <div class="content">
          <div class="title">Valetudo HASS Card</div>
          <div class="error">Render error: ${message}</div>
        </div>
      </ha-card>
    `;
  }

  _safeRender() {
    try {
      this.render();
    } catch (err) {
      console.error("valetudo-hass-card render failed", err);
      this._renderError(err);
    }
  }

  _segmentColor(segmentId, active) {
    const palette = [
      "#4da3a6",
      "#74a95f",
      "#9a6b34",
      "#577f96",
      "#8d9b49",
      "#7a689a",
      "#5f9486",
      "#b08b45",
      "#6d8f57",
      "#8f6f52",
    ];
    const index = Math.abs(parseInt(segmentId || "0", 10) || 0) % palette.length;
    return active ? palette[index] : this._withAlpha(palette[index], 0.92);
  }

  _withAlpha(hex, alpha) {
    const safe = hex.replace("#", "");
    if (safe.length !== 6) {
      return hex;
    }
    const r = parseInt(safe.substring(0, 2), 16);
    const g = parseInt(safe.substring(2, 4), 16);
    const b = parseInt(safe.substring(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  _boundsForMap(map) {
    const pixelSize = map.pixelSize || 1;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = 0;
    let maxY = 0;

    const includePoint = (x, y) => {
      if (typeof x !== "number" || typeof y !== "number") {
        return;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };

    const layers = map.layers || [];
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const dimensions = layer.dimensions || {};
      const x = dimensions.x || {};
      const y = dimensions.y || {};
      if (typeof x.min === "number" && typeof x.max === "number") {
        includePoint(x.min, y.min);
        includePoint(x.max, y.max);
      }
    }

    const entities = map.entities || [];
    for (let i = 0; i < entities.length; i += 1) {
      const points = entities[i].points || [];
      for (let p = 0; p < points.length; p += 2) {
        includePoint(points[p] / pixelSize, points[p + 1] / pixelSize);
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      const size = map.size || { x: 1000, y: 1000 };
      minX = 0;
      minY = 0;
      maxX = size.x || 1000;
      maxY = size.y || 1000;
    }

    return {
      minX: minX,
      minY: minY,
      maxX: maxX,
      maxY: maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  _drawPolyline(ctx, points, tx, ty, strokeStyle, lineWidth) {
    if (!points || points.length < 4) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(tx(points[0]), ty(points[1]));
    for (let i = 2; i < points.length; i += 2) {
      ctx.lineTo(tx(points[i]), ty(points[i + 1]));
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  _normalizePoints(points, pixelSize) {
    const normalized = [];
    for (let i = 0; i < points.length; i += 2) {
      normalized.push(points[i] / pixelSize, points[i + 1] / pixelSize);
    }
    return normalized;
  }

  _drawPolygon(ctx, points, tx, ty, fillStyle, strokeStyle) {
    if (!points || points.length < 6) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(tx(points[0]), ty(points[1]));
    for (let i = 2; i < points.length; i += 2) {
      ctx.lineTo(tx(points[i]), ty(points[i + 1]));
    }
    ctx.closePath();
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  _drawMap(canvas, payload) {
    if (!canvas || !payload || !payload.map) {
      return;
    }

    const map = payload.map;
    const pixelSize = map.pixelSize || 1;
    const bounds = this._boundsForMap(map);
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(280, canvas.clientWidth || 320);
    const padding = 12;
    const scale = Math.max(0.05, (cssWidth - padding * 2) / bounds.width);
    const cssHeight = Math.max(220, Math.round(bounds.height * scale + padding * 2));

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = cssHeight + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.imageSmoothingEnabled = false;

    const tx = (x) => padding + (x - bounds.minX) * scale;
    const ty = (y) => padding + (y - bounds.minY) * scale;

    const pixelCanvas = document.createElement("canvas");
    pixelCanvas.width = bounds.width;
    pixelCanvas.height = bounds.height;
    const pixelCtx = pixelCanvas.getContext("2d");
    pixelCtx.clearRect(0, 0, bounds.width, bounds.height);
    pixelCtx.imageSmoothingEnabled = false;

    const layers = map.layers || [];
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const compressed = layer.compressedPixels || [];
      let fill = "#7c8a96";
      if (layer.type === "wall") {
        fill = "#0f141b";
      } else if (layer.type === "segment") {
        fill = this._segmentColor(layer.metaData && layer.metaData.segmentId, layer.metaData && layer.metaData.active);
      } else if (layer.type === "floor") {
        fill = "#a9b3bc";
      }

      pixelCtx.fillStyle = fill;
      for (let c = 0; c < compressed.length; c += 3) {
        const x = compressed[c];
        const y = compressed[c + 1];
        const len = compressed[c + 2];
        pixelCtx.fillRect(
          Math.round(x - bounds.minX),
          Math.round(y - bounds.minY),
          Math.max(1, len),
          1
        );
      }
    }

    ctx.drawImage(
      pixelCanvas,
      padding,
      padding,
      Math.round(bounds.width * scale),
      Math.round(bounds.height * scale)
    );

    const entities = map.entities || [];
    let robot = null;
    let charger = null;

    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];
      const points = this._normalizePoints(entity.points || [], pixelSize);
      if (entity.type === "carpet") {
        this._drawPolygon(ctx, points, tx, ty, this._withAlpha("#d6a15c", 0.12), this._withAlpha("#d6a15c", 0.35));
      } else if (entity.type === "path" || entity.type === "predicted_path") {
        this._drawPolyline(ctx, points, tx, ty, entity.type === "path" ? "#6fd3ff" : "#7c8a96", entity.type === "path" ? 2 : 1);
      } else if (entity.type === "robot_position") {
        robot = { metaData: entity.metaData || {}, points: points };
      } else if (entity.type === "charger_location") {
        charger = { metaData: entity.metaData || {}, points: points };
      } else if (entity.__class === "PolygonMapEntity") {
        this._drawPolygon(ctx, points, tx, ty, null, this._withAlpha("#5c6b7a", 0.18));
      }
    }

    if (charger && charger.points && charger.points.length >= 2) {
      const cx = tx(charger.points[0]);
      const cy = ty(charger.points[1]);
      ctx.fillStyle = "#7bcf7e";
      ctx.fillRect(cx - 6, cy - 6, 12, 12);
      ctx.strokeStyle = "#0f141b";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 6, cy - 6, 12, 12);
    }

    if (robot && robot.points && robot.points.length >= 2) {
      const rx = tx(robot.points[0]);
      const ry = ty(robot.points[1]);
      const angle = (((robot.metaData || {}).angle || 0) - 90) * Math.PI / 180;

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(rx, ry, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#0f141b";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(rx, ry, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "#0f141b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + Math.cos(angle) * 12, ry + Math.sin(angle) * 12);
      ctx.stroke();
    }
  }

  render() {
    if (!this.shadowRoot || !this._config) {
      return;
    }

    const vacuum = this._state(this._config.vacuum);
    if (!vacuum) {
      this.shadowRoot.innerHTML = this.styles() + `
        <ha-card>
          <div class="content">Vacuum entity not found: ${this._config.vacuum}</div>
        </ha-card>
      `;
      return;
    }

    const objectId = this._config.vacuum.split(".")[1];
    const battery = this._state("sensor." + objectId + "_battery");
    const dock = this._state("sensor." + objectId + "_dock_status");
    const mode = this._state("sensor." + objectId + "_operation_mode");
    const mapReady = !!(this._mapPayload && this._mapPayload.map);
    const mapError = this._mapPayload && this._mapPayload.error;

    this.shadowRoot.innerHTML = this.styles() + `
      <ha-card>
        <div class="content">
          <div class="top">
            <div>
              <div class="title">${vacuum.attributes.friendly_name || this._config.vacuum}</div>
              <div class="state">${vacuum.state}</div>
            </div>
            <div class="meta">
              <div>build ${ValetudoHassCard.VERSION}</div>
              <div>${battery ? battery.state + "%" : "-"}</div>
              <div>${dock ? dock.state : "-"}</div>
            </div>
          </div>

          <div class="map-wrap">
            <canvas id="map"></canvas>
            <div class="map-placeholder ${mapReady ? "hidden" : ""}">
              ${mapError ? "Map error: " + mapError : (this._mapUrl ? "Loading map..." : "Map endpoint unavailable")}
            </div>
          </div>

          <div class="details">
            <div><strong>Mode:</strong> ${mode ? mode.state : "-"}</div>
            <div><strong>Map nonce:</strong> ${vacuum.attributes.map_nonce || "-"}</div>
          </div>

          <div class="buttons">
            <button id="start">Start</button>
            <button id="pause">Pause</button>
            <button id="stop">Stop</button>
            <button id="dock">Dock</button>
          </div>
        </div>
      </ha-card>
    `;

    const startButton = this.shadowRoot.getElementById("start");
    const pauseButton = this.shadowRoot.getElementById("pause");
    const stopButton = this.shadowRoot.getElementById("stop");
    const dockButton = this.shadowRoot.getElementById("dock");

    if (startButton) {
      startButton.addEventListener("click", () => this._callService("vacuum", "start"));
    }
    if (pauseButton) {
      pauseButton.addEventListener("click", () => this._callService("vacuum", "pause"));
    }
    if (stopButton) {
      stopButton.addEventListener("click", () => this._callService("vacuum", "stop"));
    }
    if (dockButton) {
      dockButton.addEventListener("click", () => this._callService("vacuum", "return_to_base"));
    }

    const canvas = this.shadowRoot.getElementById("map");
    if (canvas && mapReady) {
      this._drawMap(canvas, this._mapPayload);
    }
  }

  styles() {
    return `
      <style>
        :host {
          display: block;
        }
        .content {
          padding: 16px;
        }
        .top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .title {
          font-size: 1.1rem;
          font-weight: 600;
        }
        .state {
          color: var(--secondary-text-color);
          margin-top: 4px;
        }
        .meta {
          text-align: right;
          color: var(--secondary-text-color);
          font-size: 0.92rem;
        }
        .map-wrap {
          position: relative;
          border-radius: 14px;
          overflow: hidden;
          background: transparent;
          border: 1px solid rgba(124, 138, 150, 0.18);
          min-height: 220px;
          margin-bottom: 12px;
        }
        canvas {
          display: block;
          width: 100%;
        }
        .map-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--secondary-text-color);
          background: rgba(15, 20, 27, 0.4);
          font-size: 0.95rem;
        }
        .map-placeholder.hidden {
          display: none;
        }
        .details {
          display: grid;
          gap: 6px;
          margin-bottom: 14px;
        }
        .buttons {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .error {
          color: var(--error-color);
          margin-top: 8px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        button {
          border: none;
          border-radius: 10px;
          padding: 10px 12px;
          background: var(--primary-color);
          color: white;
          font: inherit;
          cursor: pointer;
        }
      </style>
    `;
  }
}

if (!customElements.get("valetudo-hass-card")) {
  customElements.define("valetudo-hass-card", ValetudoHassCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "valetudo-hass-card",
  name: "Valetudo HASS Card",
  description: "Lovelace card for Valetudo REST with client-side map rendering.",
});
