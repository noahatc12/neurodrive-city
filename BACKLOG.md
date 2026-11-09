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
- AI navigation in traffic (after v1.2): the city brain keeps its lane, takes every corner and stops
  for red lights, and reaches the Target on 9 of 20 unseen traffic seeds. The rest end against the
  back of a queue or in junction conflicts with oncoming or crossing traffic. Ideas: a "car ahead"
  input (gap and closing speed from the front rays), a yield input for unsignalised junctions,
  training in more than one world, and evaluating each brain on several traffic seeds per
  generation instead of one.
- Window facades for imported OSM footprints in 3D (they use plain walls today).
- Streetlights as real light sources (shadow-free point lights near the camera only).
- Speed lines in 3D (spec L2 marks them as optional; the 2D view has them).
