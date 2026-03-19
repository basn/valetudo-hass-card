# Valetudo HASS Card

Lovelace card for the `valetudo_rest` custom integration.

Current scope:

- fetch and render Valetudo map data from the `valetudo_rest` backend integration
- show vacuum status, battery, dock status, mode, water grade, and fan speed
- expose basic control buttons

Example:

```yaml
type: custom:valetudo-hass-card
vacuum: vacuum.mantequilla
```
