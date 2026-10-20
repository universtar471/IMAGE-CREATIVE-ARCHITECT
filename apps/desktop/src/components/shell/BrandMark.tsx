export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <img
      className="brand-mark"
      src={size > 40 ? "/brand/mark.svg" : "/brand/app-icon.svg"}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}

export function BrandIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-identity" aria-label="IMAGE-CREATIVE-ARCHITECT">
      <BrandMark size={compact ? 30 : 48} />
      <span className="brand-wordmark">
        <span>IMAGE-CREATIVE-</span>
        <strong>ARCHITECT</strong>
      </span>
    </span>
  );
}
