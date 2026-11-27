export function weatherVisualId(weather: string): string
export function weatherSkyMarkup(weather: string, animated?: boolean): string
export function weatherParticles(weather: string, density?: number): { left: number; top: number; delay: number }[]
