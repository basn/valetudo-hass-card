# Valetudo HASS Card

Lovelace card for the `valetudo_rest` custom integration.

Current scope:

- show a map entity if one exists
- show vacuum status, battery, dock status, mode, water grade, and fan speed
- expose basic control buttons

Example:

```yaml
type: custom:valetudo-hass-card
vacuum: vacuum.mantequilla
map_entity: image.mantequilla_map
show_controls: true
show_details: true
```

If `map_entity` is omitted or unavailable, the card still works as a status/control card.
