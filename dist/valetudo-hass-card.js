class ValetudoHassCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:valetudo-hass-card",
      vacuum: "vacuum.mantequilla",
      map_entity: "image.mantequilla_map",
      show_controls: true,
      show_details: true,
    };
  }

  setConfig(config) {
    if (!config.vacuum) {
      throw new Error("Missing required vacuum entity");
    }

    this._config = {
      show_controls: true,
      show_details: true,
      ...config,
    };

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return this._config?.map_entity ? 6 : 4;
  }

  _state(entityId) {
    return this._hass?.states?.[entityId];
  }

  _friendly(entityId) {
    return this._state(entityId)?.attributes?.friendly_name || entityId;
  }

  _call(domain, service, serviceData = {}, target) {
    if (!this._hass) return;
    const data = { ...serviceData };
    if (target) {
      data.entity_id = target;
    }
    this._hass.callService(domain, service, data);
  }

  _renderMap(mapEntityId) {
    if (!mapEntityId) {
      return "";
    }

    const mapEntity = this._state(mapEntityId);
    if (!mapEntity) {
      return `<div class="map-placeholder">Map entity not found: ${mapEntityId}</div>`;
    }

    if (mapEntity.state === "unavailable") {
      return `<div class="map-placeholder">Map unavailable</div>`;
    }

    if (mapEntityId.startsWith("camera.")) {
      return `<ha-camera-stream .hass=${this._hass} .stateObj=${mapEntity}></ha-camera-stream>`;
    }

    if (mapEntityId.startsWith("image.")) {
      const imageUrl = `/api/image/serve/${mapEntity.attributes.entity_picture?.split("/").pop()}/512x512`;
      return `<img class="map-image" src="${imageUrl}" alt="Vacuum map">`;
    }

    if (mapEntity.attributes.entity_picture) {
      return `<img class="map-image" src="${mapEntity.attributes.entity_picture}" alt="Vacuum map">`;
    }

    return `<div class="map-placeholder">Unsupported map entity: ${mapEntityId}</div>`;
  }

  _render() {
    if (!this.shadowRoot || !this._config || !this._hass) {
      return;
    }

    const vacuum = this._state(this._config.vacuum);
    if (!vacuum) {
      this.shadowRoot.innerHTML = `
        <ha-card header="Valetudo">
          <div class="card-content">Vacuum entity not found: ${this._config.vacuum}</div>
        </ha-card>
      `;
      return;
    }

    const objectId = this._config.vacuum.split(".")[1];
    const prefix = objectId.replace(/^vacuum_/, "");
    const battery = this._state(`sensor.${prefix}_battery`);
    const dock = this._state(`sensor.${prefix}_dock_status`);
    const mode = this._state(`sensor.${prefix}_operation_mode`);
    const water = this._state(`sensor.${prefix}_water_grade`);
    const fan = this._state(`sensor.${prefix}_fan_speed`);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          overflow: hidden;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .title {
          font-size: 1.1rem;
          font-weight: 600;
        }
        .status {
          color: var(--secondary-text-color);
          font-size: 0.95rem;
        }
        .map-wrap {
          background: #f4f7f9;
          border-radius: 12px;
          overflow: hidden;
          margin-top: 12px;
          min-height: 220px;
          display: grid;
          place-items: center;
        }
        .map-image {
          width: 100%;
          display: block;
        }
        .map-placeholder {
          padding: 24px;
          color: var(--secondary-text-color);
          text-align: center;
        }
        .details {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px 14px;
          margin-top: 14px;
        }
        .detail {
          background: var(--secondary-background-color);
          border-radius: 12px;
          padding: 10px 12px;
        }
        .detail-label {
          font-size: 0.8rem;
          color: var(--secondary-text-color);
          margin-bottom: 4px;
        }
        .detail-value {
          font-size: 0.98rem;
          font-weight: 600;
        }
        .controls {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-top: 14px;
        }
        button {
          border: 0;
          border-radius: 12px;
          padding: 10px 8px;
          background: var(--primary-color);
          color: white;
          font: inherit;
          cursor: pointer;
        }
        button.secondary {
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
        }
      </style>
      <ha-card>
        <div class="card-content">
          <div class="header">
            <div>
              <div class="title">${this._friendly(this._config.vacuum)}</div>
              <div class="status">${vacuum.state}</div>
            </div>
            <ha-icon icon="mdi:robot-vacuum"></ha-icon>
          </div>

          ${this._config.map_entity ? `<div class="map-wrap">${this._renderMap(this._config.map_entity)}</div>` : ""}

          ${this._config.show_details ? `
            <div class="details">
              <div class="detail">
                <div class="detail-label">Battery</div>
                <div class="detail-value">${battery?.state ?? "-" }${battery ? "%" : ""}</div>
              </div>
              <div class="detail">
                <div class="detail-label">Dock</div>
                <div class="detail-value">${dock?.state ?? "-"}</div>
              </div>
              <div class="detail">
                <div class="detail-label">Mode</div>
                <div class="detail-value">${mode?.state ?? "-"}</div>
              </div>
              <div class="detail">
                <div class="detail-label">Water</div>
                <div class="detail-value">${water?.state ?? "-"}</div>
              </div>
              <div class="detail">
                <div class="detail-label">Fan</div>
                <div class="detail-value">${fan?.state ?? "-"}</div>
              </div>
            </div>
          ` : ""}

          ${this._config.show_controls ? `
            <div class="controls">
              <button @click="">Start</button>
              <button class="secondary" data-action="pause">Pause</button>
              <button class="secondary" data-action="stop">Stop</button>
              <button class="secondary" data-action="home">Dock</button>
            </div>
          ` : ""}
        </div>
      </ha-card>
    `;

    const buttons = this.shadowRoot.querySelectorAll("button");
    buttons.forEach((button) => {
      const action = button.dataset.action || "start";
      button.addEventListener("click", () => {
        if (action === "home") {
          this._call("vacuum", "return_to_base", {}, this._config.vacuum);
        } else {
          this._call("vacuum", action, {}, this._config.vacuum);
        }
      });
    });
  }
}

customElements.define("valetudo-hass-card", ValetudoHassCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "valetudo-hass-card",
  name: "Valetudo HASS Card",
  description: "Status, controls, and optional map display for the Valetudo REST integration.",
});
