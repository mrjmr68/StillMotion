/**
 * The pairing screen.
 *
 * Spec §3: you never type on the TV. It displays four digits; you type them on
 * the phone. Nothing else is on screen because nothing else is actionable.
 */
export default function Pairing({ code }: { code: string | null }) {
  return (
    <div className="stage">
      <div className="stage__main">
        <div className="block-label">Enter this on your phone</div>
        <div className="pair-code">{code ? code : '····'}</div>
      </div>
    </div>
  );
}
