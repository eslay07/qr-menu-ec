/** Native 0.8.5+ reserves system bars before laying out WebView. Styling only. */
export function nativeOwnsSafeArea(userAgent: string): boolean {
  const version = userAgent.match(/\bQRMenuEC-Android\/(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  if (!version) return false;
  const major = Number(version[1]), minor = Number(version[2]), patch = Number(version[3]);
  return major > 0 || minor > 8 || (minor === 8 && patch >= 5);
}
