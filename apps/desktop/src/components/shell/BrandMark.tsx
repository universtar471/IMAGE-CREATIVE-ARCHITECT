export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 21 21h-3.6L12 10.4 6.6 21H3z" fill="currentColor" />
      <path d="M12 14.5 14.6 21H9.4z" fill="#8b5cf6" />
    </svg>
  );
}
