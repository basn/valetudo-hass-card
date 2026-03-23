class ValetudoHassCard extends HTMLElement {
  static get VERSION() {
    return "valetudo-ui-compact-1";
  }

  static get RUNNING_STATES() {
    return new Set(["cleaning", "returning", "moving", "segment_cleaning", "spot_cleaning"]);
  }

  static get STYLES() {
    return `
      <style>
        :host {
          display: block;
        }
        .content {
          padding: 16px;
          display: grid;
          gap: 12px;
        }
        .header {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 12px;
        }
        .title {
          font-size: 1.2rem;
          font-weight: 600;
          justify-self: start;
        }
        .chips {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-self: end;
        }
        .chip {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--divider-color);
          background: color-mix(in srgb, var(--card-background-color) 82%, var(--primary-color) 18%);
          color: var(--primary-text-color);
          font-size: 0.85rem;
        }
        .map-wrap {
          position: relative;
          border-radius: 14px;
          overflow: hidden;
          background: transparent;
          border: 1px solid rgba(124, 138, 150, 0.18);
          min-height: 220px;
        }
        .map-icon {
          position: absolute;
          z-index: 2;
          pointer-events: none;
          color: #f2f4f5;
          filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
        }
        .map-icon.robot {
          --mdc-icon-size: 20px;
        }
        .map-icon.hidden {
          display: none;
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
        .top-actions {
          display: flex;
          gap: 8px;
          align-items: center;
          justify-self: center;
        }
        .error {
          color: var(--error-color);
          margin-top: 8px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .btn {
          border: 1px solid var(--divider-color);
          border-radius: 10px;
          width: 48px;
          height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--secondary-background-color, var(--card-background-color));
          color: var(--secondary-text-color);
          font: inherit;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .btn:hover {
          background: color-mix(in srgb, var(--secondary-background-color, var(--card-background-color)) 85%, var(--primary-color) 15%);
          color: var(--primary-text-color);
        }
        .btn.primary {
          color: var(--state-icon-active-color, var(--primary-color));
        }
        .btn ha-icon {
          --mdc-icon-size: 24px;
        }
        @media (max-width: 640px) {
          .header {
            grid-template-columns: 1fr auto;
            grid-template-areas:
              "title actions"
              "chips chips";
          }
          .title {
            grid-area: title;
          }
          .top-actions {
            grid-area: actions;
          }
          .chips {
            grid-area: chips;
            justify-self: start;
          }
        }
      </style>
    `;
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
    this._abortController = null;
    this._pixelCanvas = null;
    this._pixelCtx = null;
  }

  disconnectedCallback() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
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
      return Promise.resolve();
    }

    return Promise.resolve(this._hass.callService(domain, service, { entity_id: this._config.vacuum }));
  }

  _callServiceWithFallback(domain, services) {
    if (!Array.isArray(services) || services.length === 0) {
      return Promise.resolve();
    }

    let chain = Promise.reject(new Error("fallback init"));
    for (let i = 0; i < services.length; i += 1) {
      const service = services[i];
      chain = chain.catch(() => this._callService(domain, service));
    }
    return chain.catch((err) => {
      console.error("valetudo-hass-card service call failed", domain, services, err);
    });
  }

  _callPrimaryAction(vacuumState) {
    const state = String(vacuumState || "").toLowerCase();
    if (ValetudoHassCard.RUNNING_STATES.has(state)) {
      return this._callServiceWithFallback("vacuum", ["pause", "start_pause"]);
    }
    if (state === "paused") {
      return this._callServiceWithFallback("vacuum", ["start_pause", "start", "resume"]);
    }
    return this._callServiceWithFallback("vacuum", ["start", "start_pause", "resume"]);
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

    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();

    const fetchWithAuth =
      this._hass &&
      (
        (typeof this._hass.fetchWithAuth === "function" && this._hass.fetchWithAuth.bind(this._hass)) ||
        (this._hass.auth && typeof this._hass.auth.fetchWithAuth === "function" && this._hass.auth.fetchWithAuth.bind(this._hass.auth))
      );

    const fetchOptions = { credentials: "same-origin", signal: this._abortController.signal };
    const request = fetchWithAuth
      ? fetchWithAuth(nextUrl, fetchOptions)
      : fetch(nextUrl, fetchOptions);

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
        if (err.name === "AbortError") {
          return;
        }
        console.error("valetudo-hass-card map fetch failed", err);
        this._mapPayload = {
          error: this._formatError(err),
        };
        this._safeRender();
      })
      .finally(() => {
        this._mapFetchInFlight = null;
        if (this._abortController && this._abortController.signal.aborted) {
          this._abortController = null;
        }
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
    this.shadowRoot.innerHTML = ValetudoHassCard.STYLES + `
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

  _hexToRgb(hex) {
    const safe = hex.replace("#", "");
    return {
      r: parseInt(safe.substring(0, 2), 16),
      g: parseInt(safe.substring(2, 4), 16),
      b: parseInt(safe.substring(4, 6), 16),
    };
  }

  _adjustRgb(color, percent) {
    const multiplier = (100 + percent) / 100;
    return {
      r: Math.round(Math.min(255, Math.max(0, color.r * multiplier))),
      g: Math.round(Math.min(255, Math.max(0, color.g * multiplier))),
      b: Math.round(Math.min(255, Math.max(0, color.b * multiplier))),
    };
  }

  _rgbString(color) {
    return "rgb(" + color.r + "," + color.g + "," + color.b + ")";
  }

  _rgbaString(color, alpha) {
    return "rgba(" + color.r + "," + color.g + "," + color.b + "," + alpha + ")";
  }

  _isDarkMode() {
    if (this._hass && this._hass.themes && typeof this._hass.themes.darkMode === "boolean") {
      return this._hass.themes.darkMode;
    }
    if (typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  }

  _valetudoColors() {
    const brightPalette = {
      floor: this._hexToRgb("#0076FF"),
      path: this._hexToRgb("#111111"),
      predictedPath: this._hexToRgb("#8A939A"),
      segments: [
        this._hexToRgb("#19A1A1"),
        this._hexToRgb("#7AC037"),
        this._hexToRgb("#DF5618"),
        this._hexToRgb("#F7C841"),
        this._hexToRgb("#9966CC"),
      ],
      floorAccentDelta: -7.5,
      wallAccentDelta: -5,
      segmentAccentDelta: -7.5,
    };
    const darkPalette = {
      floor: this._hexToRgb("#005ECC"),
      path: this._hexToRgb("#111111"),
      predictedPath: this._hexToRgb("#8A939A"),
      segments: [
        this._hexToRgb("#148181"),
        this._hexToRgb("#629A2C"),
        this._hexToRgb("#B24513"),
        this._hexToRgb("#C6A034"),
        this._hexToRgb("#7A52A3"),
      ],
      floorAccentDelta: -25,
      wallAccentDelta: -15,
      segmentAccentDelta: -25,
    };

    const activePalette = this._isDarkMode() ? darkPalette : brightPalette;
    const wall = this._hexToRgb("#333333");

    return {
      wall: wall,
      floor: activePalette.floor,
      path: activePalette.path,
      predictedPath: activePalette.predictedPath,
      segments: activePalette.segments,
      floorAccent: this._adjustRgb(activePalette.floor, activePalette.floorAccentDelta),
      wallAccent: this._adjustRgb(wall, activePalette.wallAccentDelta),
      segmentAccent: activePalette.segments.map((c) => this._adjustRgb(c, activePalette.segmentAccentDelta)),
    };
  }

  _segmentIndex(segmentId) {
    return Math.abs(parseInt(segmentId || "0", 10) || 0) % 5;
  }

  _materialPattern(material, x, y) {
    if (material === "tile") {
      const TILE_SIZE = 6;
      return x % TILE_SIZE === 0 || y % TILE_SIZE === 0;
    }

    if (material === "wood_horizontal" || material === "wood_vertical") {
      const horizontal = material === "wood_horizontal";
      const PLANK_WIDTH = 5;
      const PLANK_LENGTH = 24;
      const JOINT_OFFSET = PLANK_LENGTH / 2;
      const mainAxisCoord = horizontal ? y : x;
      const crossAxisCoord = horizontal ? x : y;
      if (mainAxisCoord % PLANK_WIDTH === 0) {
        return true;
      }
      const plankStripIndex = Math.floor(mainAxisCoord / PLANK_WIDTH);
      const currentJointPosition = plankStripIndex % 2 === 0 ? 0 : JOINT_OFFSET;
      return crossAxisCoord % PLANK_LENGTH === currentJointPosition;
    }

    if (material === "wood") {
      const PLANK_WIDTH = 4;
      const SECTION_WIDTH = 8;
      const zig = Math.floor(x / SECTION_WIDTH) % 2 === 0;
      const diagonalValue = zig ? x + y : x - y;
      return diagonalValue % PLANK_WIDTH === 0;
    }

    return false;
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
      return { robot: null, charger: null };
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
    const colors = this._valetudoColors();

    const tx = (x) => padding + (x - bounds.minX) * scale;
    const ty = (y) => padding + (y - bounds.minY) * scale;

    ctx.fillStyle = this._rgbString(colors.wallAccent);
    ctx.fillRect(
      padding - 2,
      padding - 2,
      Math.round(bounds.width * scale) + 4,
      Math.round(bounds.height * scale) + 4
    );

    if (!this._pixelCanvas || this._pixelCanvas.width !== bounds.width || this._pixelCanvas.height !== bounds.height) {
      this._pixelCanvas = document.createElement("canvas");
      this._pixelCanvas.width = bounds.width;
      this._pixelCanvas.height = bounds.height;
      this._pixelCtx = this._pixelCanvas.getContext("2d");
      this._pixelCtx.imageSmoothingEnabled = false;
    } else {
      this._pixelCtx.clearRect(0, 0, bounds.width, bounds.height);
    }

    const layers = map.layers || [];
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const compressed = layer.compressedPixels || [];
      for (let c = 0; c < compressed.length; c += 3) {
        const x = compressed[c];
        const y = compressed[c + 1];
        const len = compressed[c + 2];
        for (let offset = 0; offset < len; offset += 1) {
          const px = x + offset;
          let color = colors.floor;
          if (layer.type === "wall") {
            color = colors.wall;
          } else if (layer.type === "floor") {
            const useAccent = this._materialPattern(layer.metaData && layer.metaData.material, px, y);
            color = useAccent ? colors.floorAccent : colors.floor;
          } else if (layer.type === "segment") {
            const idx = this._segmentIndex(layer.metaData && layer.metaData.segmentId);
            const useAccent = this._materialPattern(layer.metaData && layer.metaData.material, px, y);
            color = useAccent ? colors.segmentAccent[idx] : colors.segments[idx];
          }
          this._pixelCtx.fillStyle = this._rgbString(color);
          this._pixelCtx.fillRect(
            Math.round(px - bounds.minX),
            Math.round(y - bounds.minY),
            1,
            1
          );
        }
      }
    }

    ctx.drawImage(
      this._pixelCanvas,
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
        const carpetBase = this._hexToRgb("#2f302f");
        this._drawPolygon(ctx, points, tx, ty, this._rgbaString(carpetBase, 0.10), this._rgbaString(carpetBase, 0.14));
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(tx(points[0]), ty(points[1]));
        for (let p = 2; p < points.length; p += 2) {
          ctx.lineTo(tx(points[p]), ty(points[p + 1]));
        }
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = "rgba(34, 36, 38, 0.18)";
        ctx.lineWidth = 1;
        for (let x = -cssHeight; x < cssWidth + cssHeight; x += 6) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + cssHeight, cssHeight);
          ctx.stroke();
        }
        ctx.restore();
      } else if (entity.type === "path" || entity.type === "predicted_path") {
        this._drawPolyline(
          ctx,
          points,
          tx,
          ty,
          entity.type === "path" ? this._rgbString(colors.path) : this._rgbString(colors.predictedPath),
          entity.type === "path" ? 1 : 1
        );
      } else if (entity.type === "robot_position") {
        robot = { metaData: entity.metaData || {}, points: points };
      } else if (entity.type === "charger_location") {
        charger = { metaData: entity.metaData || {}, points: points };
      } else if (entity.__class === "PolygonMapEntity") {
        this._drawPolygon(ctx, points, tx, ty, null, "rgba(24, 26, 29, 0.18)");
      }
    }

    let robotPos = null;
    if (robot && robot.points && robot.points.length >= 2) {
      const rx = tx(robot.points[0]);
      const ry = ty(robot.points[1]);
      const angle = (((robot.metaData || {}).angle || 0) - 90) * Math.PI / 180;
      robotPos = { x: rx, y: ry, angle };
    }

    let chargerPos = null;
    if (charger && charger.points && charger.points.length >= 2) {
      const cx = tx(charger.points[0]);
      const cy = ty(charger.points[1]);
      chargerPos = { x: cx, y: cy };
    }

    return { robot: robotPos, charger: chargerPos };
  }

  render() {
    if (!this.shadowRoot || !this._config) {
      return;
    }

    const vacuum = this._state(this._config.vacuum);
    if (!vacuum) {
      this.shadowRoot.innerHTML = ValetudoHassCard.STYLES + `
        <ha-card>
          <div class="content">Vacuum entity not found: ${this._config.vacuum}</div>
        </ha-card>
      `;
      return;
    }

    const objectId = this._config.vacuum.split(".")[1];
    const battery = vacuum.attributes.battery_level ?? this._state("sensor." + objectId + "_battery")?.state ?? "-";
    const mapReady = !!(this._mapPayload && this._mapPayload.map);
    const mapError = this._mapPayload && this._mapPayload.error;
    const vacuumState = String(vacuum.state || "").toLowerCase();
    const isRunning = ValetudoHassCard.RUNNING_STATES.has(vacuumState);
    const isPaused = vacuumState === "paused";
    const primaryAction = isRunning
      ? { label: "Pause", service: "pause", icon: "mdi:pause" }
      : (isPaused ? { label: "Resume", service: "start_pause", icon: "mdi:play" } : { label: "Start", service: "start", icon: "mdi:play" });
    const secondaryAction = { label: "Return to dock", service: "return_to_base", icon: "mdi:home" };

    this.shadowRoot.innerHTML = ValetudoHassCard.STYLES + `
      <ha-card>
        <div class="content">
          <div class="header">
            <div class="title">${vacuum.attributes.friendly_name || this._config.vacuum}</div>
            <div class="top-actions">
              <button id="primary" class="btn primary" aria-label="${primaryAction.label}" title="${primaryAction.label}">
                <ha-icon icon="${primaryAction.icon}"></ha-icon>
              </button>
              <button id="secondary" class="btn" aria-label="${secondaryAction.label}" title="${secondaryAction.label}">
                <ha-icon icon="${secondaryAction.icon}"></ha-icon>
              </button>
            </div>
            <div class="chips">
              <span class="chip">${vacuum.state}</span>
              <span class="chip">${battery !== "-" ? battery + "%" : "-"}</span>
            </div>
          </div>

          <div class="map-wrap">
            <canvas id="map"></canvas>
            <ha-icon id="map-robot-icon" class="map-icon robot hidden" icon="mdi:robot-vacuum"></ha-icon>
            <div class="map-placeholder ${mapReady ? "hidden" : ""}">
              ${mapError ? "Map error: " + mapError : (this._mapUrl ? "Loading map..." : "Map endpoint unavailable")}
            </div>
          </div>
        </div>
      </ha-card>
    `;

    const primaryButton = this.shadowRoot.getElementById("primary");
    const secondaryButton = this.shadowRoot.getElementById("secondary");

    if (primaryButton) {
      primaryButton.addEventListener("click", () => this._callPrimaryAction(vacuum.state));
    }
    if (secondaryButton) {
      secondaryButton.addEventListener("click", () => this._callService("vacuum", secondaryAction.service));
    }

    const canvas = this.shadowRoot.getElementById("map");
    const robotIcon = this.shadowRoot.getElementById("map-robot-icon");
    if (canvas && mapReady) {
      const drawn = this._drawMap(canvas, this._mapPayload);
      if (robotIcon && drawn && drawn.robot) {
        robotIcon.classList.remove("hidden");
        robotIcon.style.left = drawn.robot.x + "px";
        robotIcon.style.top = drawn.robot.y + "px";
        robotIcon.style.transform = "translate(-50%, -50%) rotate(" + drawn.robot.angle + "rad)";
      } else if (robotIcon) {
        robotIcon.classList.add("hidden");
      }
    } else if (robotIcon) {
      robotIcon.classList.add("hidden");
    }
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
