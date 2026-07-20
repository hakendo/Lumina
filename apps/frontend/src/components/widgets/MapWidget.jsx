import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { useMemo, useState } from 'react';
import { Icon } from '../ui';
import { useDatasetMeta, WidgetFooter } from './useDatasetMeta';

export default function MapWidget({ config, data, datasetId }) {
  const { latField, lonField, labelField, title } = config;
  const meta = useDatasetMeta(datasetId);
  const [search, setSearch] = useState('');

  const allPoints = useMemo(() => {
    if (!data?.length || !latField || !lonField) return [];
    return data
      .map((r) => ({ lat: Number(r[latField]), lon: Number(r[lonField]), label: r[labelField] || '' }))
      .filter((p) => !isNaN(p.lat) && !isNaN(p.lon));
  }, [data, config]);

  const points = useMemo(() => {
    if (!search.trim()) return allPoints;
    const q = search.toLowerCase();
    return allPoints.filter((p) => p.label.toLowerCase().includes(q));
  }, [allPoints, search]);

  if (!allPoints.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-ink-faint text-sm gap-2">
        <Icon name="pin" size={22} strokeWidth={1.6} />
        <span>{latField && lonField ? 'Sin coordenadas válidas' : 'Configura los campos lat/lon'}</span>
      </div>
    );
  }

  const center = [points[0]?.lat ?? allPoints[0].lat, points[0]?.lon ?? allPoints[0].lon];

  return (
    <div className="h-full flex flex-col overflow-hidden rounded drag-cancel">
      <div className="flex items-center gap-2 px-2 py-1 shrink-0 border-b border-line-soft">
        {title && <p className="text-xs font-semibold text-ink-soft truncate">{title}</p>}
        <div className="flex-1" />
        {labelField && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar punto…"
            className="text-[11px] font-mono bg-paper-deep border border-line rounded px-2 py-0.5 w-28 focus:w-36 transition-all focus:outline-none focus:border-lumen placeholder:text-ink-faint/40"
          />
        )}
        <span className="text-[10px] font-mono text-ink-faint shrink-0">
          {points.length !== allPoints.length
            ? `${points.length} / ${allPoints.length}`
            : allPoints.length} puntos
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden border-b border-line-soft">
        <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }} key={`${latField}-${lonField}`}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {points.map((p, i) => (
            <CircleMarker key={i} center={[p.lat, p.lon]} radius={6} fillColor="#08cdff" color="#031560" fillOpacity={0.85}>
              {p.label && <Popup>{p.label}</Popup>}
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <WidgetFooter dataCount={points.length} dataLabel="puntos" meta={meta} />
    </div>
  );
}
