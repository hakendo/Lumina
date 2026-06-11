import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { useMemo } from 'react';
import { Icon } from '../ui';

export default function MapWidget({ config, data }) {
  const { latField, lonField, labelField, title } = config;

  const points = useMemo(() => {
    if (!data?.length || !latField || !lonField) return [];
    return data
      .map((r) => ({ lat: Number(r[latField]), lon: Number(r[lonField]), label: r[labelField] || '' }))
      .filter((p) => !isNaN(p.lat) && !isNaN(p.lon));
  }, [data, config]);

  if (!points.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-ink-faint text-sm gap-2">
        <Icon name="pin" size={22} strokeWidth={1.6} />
        <span>{latField && lonField ? 'Sin coordenadas válidas' : 'Configura los campos lat/lon'}</span>
      </div>
    );
  }

  const center = [points[0].lat, points[0].lon];

  return (
    <div className="h-full flex flex-col overflow-hidden rounded">
      {title && <p className="text-xs font-semibold text-ink-soft mb-1 px-1 shrink-0">{title}</p>}
      <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-line-soft">
        <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }} key={`${latField}-${lonField}`}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {points.map((p, i) => (
            <CircleMarker key={i} center={[p.lat, p.lon]} radius={6} fillColor="#e9a23b" color="#8f5808" fillOpacity={0.85}>
              {p.label && <Popup>{p.label}</Popup>}
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
