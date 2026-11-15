"use client";

/** A lightweight CSS sculpture; decorative, with no canvas or animation library. */
export function LuxeScene({ compact = false }: { compact?: boolean }) {
  return <div className={`luxe-scene${compact ? " luxe-scene-compact" : ""}`} aria-hidden="true">
    <div className="luxe-scene-halo" />
    <div className="luxe-sculpture">
      <div className="luxe-orbit luxe-orbit-one" />
      <div className="luxe-orbit luxe-orbit-two" />
      <div className="luxe-core"><span>L</span><i /></div>
      <div className="luxe-plinth luxe-plinth-top" />
      <div className="luxe-plinth luxe-plinth-bottom" />
      <div className="luxe-satellite luxe-satellite-one"><span className="luxe-satellite-dot" /><span>Discover<small>Find your audience</small></span></div>
      <div className="luxe-satellite luxe-satellite-two"><span className="luxe-satellite-dot" /><span>Connect<small>Make it personal</small></span></div>
    </div>
    <div className="luxe-scene-caption"><span /> THE ART OF OPPORTUNITY</div>
  </div>;
}
