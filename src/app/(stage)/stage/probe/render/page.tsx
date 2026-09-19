import RenderTest from './RenderTest';

/**
 * /stage/probe/render — the load test behind the renderer decision.
 *
 * The capability probe reports what the set CLAIMS. This reports what it
 * actually does with a rigged human on screen, which is the only number that
 * decides whether the movement figures are live 3D or pre-rendered video.
 */
export default function RenderProbePage() {
  return <RenderTest />;
}
