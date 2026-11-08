# Backlog

Ideas deliberately kept out of scope until the Definition of Done is met.

- Curved roads (Bezier segments) instead of straight graph segments.
- Per-segment lane counts and road widths.
- Manual building placement and editing.
- Animated pedestrians on zebra crossings (D3 optional item).
- Run replay: record seeds and inputs, scrub through a generation.
- WebGPU renderer (`WebGPURenderer`) as a third `Renderer` implementation.
- NEAT (topology-evolving networks) as an alternative to fixed-topology evolution.
- Reinforcement learning baseline (policy gradient) to compare against neuro-evolution.
- AI navigation (F5) that turns corners: curriculum training (straight, then one turn, then the full
  route), more generations with tanh steering, or extra inputs such as distance to the next junction.
  The current toggle and its honest results are documented in the README.
- Window facades for imported OSM footprints in 3D (they use plain walls today).
- Streetlights as real light sources (shadow-free point lights near the camera only).
- A city-trained demo brain for Simulate mode (today it uses the highway-trained brain).
- Speed lines in 3D (spec L2 marks them as optional; the 2D view has them).
