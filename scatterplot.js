import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Keep this CSV in the same folder as scatterplot.js.
const csvUrl = new URL("./steam_games_2026.csv", import.meta.url);

const columns = {
  name: "Name",
  price: "Price_USD",
  score: "Review_Score_Pct",
  reviews: "Total_Reviews",
  genre: "Primary_Genre",
};

const allPrices = { label: "All prices", min: 0, max: Infinity };
const priceRanges = [
  allPrices,
  { label: "$0–$20", min: 0, max: 20 },
  { label: "$20–$40", min: 20, max: 40 },
  { label: "$40–$60", min: 40, max: 60 },
  { label: "$60+", min: 60, max: Infinity },
];

const width = 800;
const height = 480;
const margin = { top: 24, right: 34, bottom: 64, left: 76 };
const plotWidth = width - margin.left - margin.right;
const plotHeight = height - margin.top - margin.bottom;

const svg = d3.select("#scatterplot");
const legend = d3.select("#genre-legend");
const zoomControls = d3.select("#price-zoom");
const status = d3.select("#scatterplot-status");
const tooltip = d3.select("#scatterplot-tooltip");

const formatPrice = d3.format("$,.2f");
const formatScore = d3.format(".1%");
const formatCount = d3.format(",d");

let activeDot = null;

function parseNumber(value) {
  const cleaned = value?.trim().replace(/[$,]/g, "");
  return cleaned ? Number(cleaned) : NaN;
}

function parseGame(row, index) {
  const name = row[columns.name]?.trim();
  const price = parseNumber(row[columns.price]);
  const scorePercent = parseNumber(row[columns.score]);
  const reviews = parseNumber(row[columns.reviews]);
  const genre = row[columns.genre]?.trim() || "Unknown";

  if (
    !name ||
    !Number.isFinite(price) || price < 0 ||
    !Number.isFinite(scorePercent) || scorePercent < 0 || scorePercent > 100 ||
    !Number.isFinite(reviews) || reviews <= 0
  ) {
    return null;
  }

  return { id: index, name, price, score: scorePercent / 100, reviews, genre };
}

function moveTooltip(event) {
  const { offsetWidth, offsetHeight } = tooltip.node();
  const left = Math.min(event.clientX + 12, window.innerWidth - offsetWidth - 8);
  const top = Math.min(event.clientY + 12, window.innerHeight - offsetHeight - 8);

  tooltip
    .style("left", `${Math.max(8, left)}px`)
    .style("top", `${Math.max(8, top)}px`);
}

function hideTooltip() {
  tooltip.property("hidden", true);

  if (activeDot) {
    activeDot.classed("is-active", false);
    activeDot = null;
  }
}

function showTooltip(event, game) {
  hideTooltip();
  activeDot = d3.select(event.currentTarget).classed("is-active", true);

  tooltip.select("#tooltip-name").text(game.name);
  tooltip.select("#tooltip-genre").text(`Genre: ${game.genre}`);
  tooltip.select("#tooltip-price").text(
    `Price: ${game.price === 0 ? "Free" : formatPrice(game.price)}`
  );
  tooltip.select("#tooltip-score").text(`Positive reviews: ${formatScore(game.score)}`);
  tooltip.select("#tooltip-reviews").text(`Total reviews: ${formatCount(game.reviews)}`);

  tooltip.property("hidden", false);
  moveTooltip(event);
}

async function drawScatterplot() {
  const rows = await d3.csv(csvUrl.href);
  const missingColumns = Object.values(columns)
    .filter(column => !rows.columns.includes(column));

  if (missingColumns.length) {
    throw new Error(`Missing CSV columns: ${missingColumns.join(", ")}.`);
  }

  const games = rows.map(parseGame).filter(game => game !== null);

  if (games.length === 0) {
    throw new Error("No games with a valid price and at least one review.");
  }

  const genres = Array.from(new Set(games.map(game => game.genre)))
    .sort(d3.ascending);

  const palette = genres.length <= d3.schemeTableau10.length
    ? d3.schemeTableau10
    : genres.map((_, index) => d3.interpolateRainbow(index / genres.length));

  const genreColor = d3.scaleOrdinal()
    .domain(genres)
    .range(palette);

  const x = d3.scaleLinear()
    .domain([0, d3.max(games, game => game.price) || 1])
    .nice()
    .range([0, plotWidth]);

  const fullPriceDomain = x.domain();

  const y = d3.scaleLinear()
    .domain([0, 1])
    .range([plotHeight, 0]);

  const plot = svg.append("g")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);

  plot.append("g")
    .attr("class", "scatterplot-grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-plotWidth).tickFormat(() => ""));

  const xAxis = plot.append("g")
    .attr("class", "scatterplot-axis")
    .attr("transform", `translate(0, ${plotHeight})`);

  plot.append("g")
    .attr("class", "scatterplot-axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));

  plot.append("text")
    .attr("class", "scatterplot-axis-label")
    .attr("x", plotWidth / 2)
    .attr("y", plotHeight + 48)
    .text("Price (USD)");

  plot.append("text")
    .attr("class", "scatterplot-axis-label")
    .attr("transform", `translate(-54, ${plotHeight / 2}) rotate(-90)`)
    .text("Positive reviews (%)");

  const dots = plot.append("g");
  let selectedGenre = null;
  let selectedPriceRange = allPrices;

  const genreButtons = legend.selectAll("button")
    .data(genres)
    .join("button")
    .attr("type", "button")
    .attr("class", "chart-button")
    .on("click", (_event, genre) => {
      selectedGenre = selectedGenre === genre ? null : genre;
      update();
    });

  genreButtons.append("span")
    .attr("class", "genre-swatch")
    .attr("aria-hidden", "true")
    .style("background-color", genre => genreColor(genre));

  genreButtons.append("span").text(genre => genre);

  const priceButtons = zoomControls.selectAll("button")
    .data(priceRanges)
    .join("button")
    .attr("type", "button")
    .attr("class", "chart-button")
    .text(range => range.label)
    .on("click", (_event, range) => {
      selectedPriceRange = range;
      update();
    });

  function update() {
    hideTooltip();

    const { min, max } = selectedPriceRange;

    if (selectedPriceRange === allPrices) {
      x.domain(fullPriceDomain);
    } else {
      const axisMax = Number.isFinite(max) ? max : Math.max(70, fullPriceDomain[1]);
      x.domain([min, axisMax]);
    }

    xAxis.call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("$~f")));

    const visibleGames = games.filter(game => {
      const matchesGenre = selectedGenre === null || game.genre === selectedGenre;
      return matchesGenre && game.price >= min && game.price < max;
    });

    genreButtons
      .attr("aria-pressed", genre => String(genre === selectedGenre))
      .classed("is-muted", genre => selectedGenre !== null && genre !== selectedGenre);

    priceButtons.attr("aria-pressed", range => String(range === selectedPriceRange));

    dots.selectAll("circle")
      .data(visibleGames, game => game.id)
      .join("circle")
      .attr("class", "game-dot")
      .attr("cx", game => x(game.price))
      .attr("cy", game => y(game.score))
      .attr("fill", game => genreColor(game.genre))
      .on("pointerenter", (event, game) => {
        if (event.pointerType !== "touch") showTooltip(event, game);
      })
      .on("pointermove", event => {
        if (event.pointerType !== "touch" && activeDot) moveTooltip(event);
      })
      .on("pointerleave", event => {
        if (event.pointerType !== "touch") hideTooltip();
      })
      .on("click", (event, game) => {
        event.stopPropagation();
        showTooltip(event, game);
      });

    const genreLabel = selectedGenre ?? "All genres";
    const visibleCount = formatCount(visibleGames.length);
    const totalCount = formatCount(games.length);

    status.text(
      `${genreLabel} · ${selectedPriceRange.label} · ${visibleCount} of ${totalCount} games shown`
    );
  }

  document.addEventListener("click", hideTooltip);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") hideTooltip();
  });

  update();
}

drawScatterplot().catch(error => {
  status.text(`Could not load the chart. ${error.message}`);
});
