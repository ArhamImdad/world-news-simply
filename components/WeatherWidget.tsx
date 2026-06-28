export type WeatherWidgetData = {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  icon: string;
};

export default function WeatherWidget({ weather }: { weather: WeatherWidgetData }) {
  return (
    <section className="weather-widget" aria-label="Weather in Lahore Pakistan">
      <div className={`weather-icon weather-${weather.icon}`} aria-hidden="true" />
      <div>
        <p>Lahore Weather</p>
        <h2>{weather.temperature}C</h2>
        <span>{weather.condition}</span>
      </div>
      <dl>
        <div>
          <dt>Humidity</dt>
          <dd>{weather.humidity}%</dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd>{weather.windSpeed} km/h</dd>
        </div>
      </dl>
    </section>
  );
}
