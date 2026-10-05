# GRINDWORKS — prototype

Factory automation × action skating, in three.js. *Your best run becomes the machine.*

```bash
npm install
npm run dev      # http://localhost:5173
```

## The loop

1. **Skate** the starter line: hop on the yellow rail over the pink ore seam (`L`). Grinding mines **ORE** and builds **HEAT**.
2. Roll through the **Smelter Gate** while your combo is still alive. It takes the ore and heat and makes **INGOTS**. Pick them up on the next pass.
3. Ollie and grind the **Ship Ledge** to ship everything in your bag.
4. Press **R** to start recording, skate a loop, and press **R** again back at the pink ring. That run is now a **Ghost** that repeats the line forever and keeps your factory running.
5. Press **Tab** for build mode. Lay rails, kickers, quarter pipes, presses, and mills, and design lines for new Ghosts.

## Trick energy → recipes

| Flavor | From | Feeds |
|---|---|---|
| HEAT | grinding (+1 per rail cell) | Smelter: ORE + 3 HEAT → INGOT |
| PRESSURE | manuals (+1 per 0.4s) | Manual Press: INGOT + 2 PRESSURE → PLATE |
| SPIN | flips, each 180° of spin | Spin Mill: PLATE + 2 SPIN + 1 LIFT → GEAR |
| LIFT | grabs, air time | Spin Mill |

Your combo multiplier (**stoke**) scales the energy you deliver, up to ×4. Bailing or letting the combo lapse drops all the energy you're carrying.

## Controls

**Skate**: `W` push · `S` brake · `A/D` steer / spin · `Space` ollie · `J` flip · `K` grab (hold) · `L` grind · `Shift` manual · hold a direction for trick variants · `R` record · `C` cancel recording · `T` respawn · `Tab` build · `Esc` menu

**Build**: `1–7` piece · `X` delete tool · `R` rotate · LMB place (drag to lay rails) · RMB delete · `WASD` / middle-drag pan · `Q/E` turn camera · wheel zoom

**Gamepad** (standard mapping): A ollie · X flip · B grab · Y grind · RT manual · Start record · Select build mode. In build mode: stick moves the cursor · A place · B delete · Y rotate · LB/RB cycle pieces · right stick zoom.

## Code map

- `src/game/skater.js`: arcade physics, tricks, combo, energy
- `src/game/actor.js`: shared world interaction for the player and Ghosts (mining, machines, shipping)
- `src/game/ghosts.js`: recorder, looping replay, line validation
- `src/game/machines.js`: recipes and machine sim
- `src/world/world.js`: grid, terrain heights, rail graph, persistence
- `src/world/pieces.js`: piece definitions (each is skate geometry and a factory part)
- `src/ui/build.js`: top-down build mode
- `src/render/*`: cel shading, outlines, sky/city, skater model, effects
