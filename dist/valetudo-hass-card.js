class ValetudoHassCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:valetudo-hass-card",
      vacuum: "vacuum.mantequilla",
    };
  }

  setConfig(config) {
    if (!config || !config.vacuum) {
      throw new Error("Missing required vacuum entity");
    }

    this._config = config;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return 4;
  }

  callService(domain, service) {
    if (!this._hass || !this._config?.vacuum) {
      return;
    }
    this._hass.callService(domain, service, { entity_id: this._config.vacuum });
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }

    if (!this._config) {
      this.shadowRoot.innerHTML = "";
      return;
    }

    const vacuum = this._hass?.states?.[this._config.vacuum];

    if (!vacuum) {
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div class="content">Vacuum entity not found: ${this._config.vacuum}</div>
        </ha-card>
        ${this.styles()}
      `;
      return;
    }

    const objectId = this._config.vacuum.split(".")[1];
    const battery = this._hass.states[`sensor.${objectId}_battery`];
    const dock = this._hass.states[`sensor.${objectId}_dock_status`];
    const mode = this._hass.states[`sensor.${objectId}_operation_mode`];

    this.shadowRoot.innerHTML = `
      ${this.styles()}
      <ha-card>
        <div class="content">
          <div class="title">${vacuum.attributes.friendly_name || this._config.vacuum}</div>
          <div class="state">${vacuum.state}</div>

          <div class="details">
            <div><strong>Battery:</strong> ${battery ? battery.state + "%" : "-"}</div>
            <div><strong>Dock:</strong> ${dock ? dock.state : "-"}</div>
            <div><strong>Mode:</strong> ${mode ? mode.state : "-"}</div>
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

    this.shadowRoot.getElementById("start")?.addEventListener("click", () => this.callService("vacuum", "start"));
    this.shadowRoot.getElementById("pause")?.addEventListener("click", () => this.callService("vacuum", "pause"));
    this.shadowRoot.getElementById("stop")?.addEventListener("click", () => this.callService("vacuum", "stop"));
    this.shadowRoot.getElementById("dock")?.addEventListener("click", () => this.callService("vacuum", "return_to_base"));
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
        .title {
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .state {
          color: var(--secondary-text-color);
          margin-bottom: 14px;
        }
        .details {
          display: grid;
          gap: 8px;
          margin-bottom: 16px;
        }
        .buttons {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
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

customElements.define("valetudo-hass-card", ValetudoHassCard);

console.info("valetudo-hass-card minimal build 2026-03-19");

window.customCards = window.customCards || [];
window.customCards.push({
  type: "valetudo-hass-card",
  name: "Valetudo HASS Card",
  description: "Simple Lovelace card for the Valetudo REST integration.",
});
