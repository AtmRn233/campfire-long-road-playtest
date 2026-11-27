export function weatherVisualId(weather) {
  if (weather === "cloudy") return "overcast";
  if (weather === "heavy-fog") return "thick-fog";
  return weather;
}

export function weatherSkyMarkup(weather, animated = true) {
  const sky = weather === "overcast" ? "cloudy" : weather;
  if (sky !== "clear" && sky !== "cloudy" && sky !== "wind") return "";
  const clouds = '<span class="weather-cloud-shadow fx-loop"></span>'.repeat(5);
  const sunlight = sky === "clear"
    ? '<div class="weather-sunlight fx-loop"><div class="weather-sunbeams"><span></span><span></span><span></span><span></span></div></div>'
    : "";
  return '<div class="weather-sky' + (animated ? ' moving' : '') + '" data-sky="' + sky + '" aria-hidden="true">' + clouds + sunlight + '</div>';
}

const particleCounts = {
  "light-rain": 28, "heavy-rain": 66, wind: 13, "light-snow": 35, "heavy-snow": 84,
};

export function weatherParticles(weather, density = 1) {
  const count = Math.round((particleCounts[weather] ?? 0) * density);
  const stagger = weather.endsWith("-snow") ? 8 : 1;
  return Array.from({ length: count }, (_, index) => ({
    left: (index * 47 + 7) % 101,
    top: (index * 29 + 11) % 97,
    delay: -(((index * 17) % 100) / 100) * stagger,
  }));
}
