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
- AI navigation in traffic (v1.1 follow-up): the bundled city brain keeps its lane and takes every
  corner, but on unseen traffic most drives end against a queue at the signalised junction. Two
  changes would let training teach queueing: (1) a training ghost should only be damaged by what it
  drives into, not by traffic that cannot see it driving into its back (today waiting in a queue is
  punished as a crash); (2) a traffic-light input (state and distance of the next light on the
  route). Evaluate on many traffic seeds, not five.
- Window facades for imported OSM footprints in 3D (they use plain walls today).
- Streetlights as real light sources (shadow-free point lights near the camera only).
- Speed lines in 3D (spec L2 marks them as optional; the 2D view has them).
