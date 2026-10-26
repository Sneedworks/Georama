/** True only when MSVC's C++ headers and Windows SDK includes/libs exist. */
export function hasMsvcBuildEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  fileExists?: (path: string) => boolean,
): boolean;
