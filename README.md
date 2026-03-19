# Valetudo HASS Card

Lovelace card for the `valetudo_rest` custom integration.

Personal project notice:

- built for a single personal Home Assistant setup
- vibecoded with iterative real-world testing
- not production-grade software and no compatibility guarantees

Current scope:

- fetch and render Valetudo map data from the `valetudo_rest` backend integration
- show vacuum status, battery, dock status, mode, water grade, and fan speed
- expose basic control buttons

Example:

```yaml
type: custom:valetudo-hass-card
vacuum: vacuum.mantequilla
```
