import Capabilities from './Capabilities';

/**
 * /stage/probe — what can this television actually do?
 *
 * Built to answer one question with evidence instead of opinion: should the
 * movement animations be rendered live in 3D on the set, or rendered offline and
 * played back as video loops?
 *
 * The prior is strong — this is a browser that could not parse optional
 * chaining, and `<video>` decode is hardware-accelerated on televisions while
 * WebGL with a skinned mesh is very much not. But "strong prior" is how the last
 * three hours of wrong guesses started, so the set gets asked directly.
 *
 * Deliberately a separate route from the stage itself. It must still render if
 * WebGL throws on creation, which is exactly the failure it exists to detect.
 */
export default function ProbePage() {
  return <Capabilities />;
}
