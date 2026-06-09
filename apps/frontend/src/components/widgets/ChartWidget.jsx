import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function ChartWidget({ config, data }) {
  const { chartType = 'bar', xField, yField, sizeField, labelField, title } = config;

  const option = useMemo(() => {
    const empty = {
      title: {
        text: title || 'Sin datos',
        left: 'center', top: 'middle',
        textStyle: { color: '#94a3b8', fontSize: 13 },
      },
    };

    if (!data?.length) return empty;

    const base = {
      tooltip: { trigger: chartType === 'scatter' ? 'item' : 'axis' },
      color: COLORS,
      grid: { left: 48, right: 16, top: title ? 36 : 16, bottom: 36 },
      ...(title && { title: { text: title, textStyle: { fontSize: 12, fontWeight: 600, color: '#475569' }, top: 4, left: 8 } }),
    };

    if (chartType === 'pie') {
      if (!xField || !yField) return empty;
      return {
        ...base,
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          data: data.map((r) => ({ name: r[xField], value: Number(r[yField]) || 0 })),
          label: { show: true, formatter: '{b}\n{d}%', fontSize: 11 },
        }],
      };
    }

    if (chartType === 'scatter') {
      if (!xField || !yField) return empty;
      return {
        ...base,
        xAxis: { type: 'value', name: xField, nameTextStyle: { fontSize: 11 } },
        yAxis: { type: 'value', name: yField, nameTextStyle: { fontSize: 11 } },
        series: [{
          type: 'scatter',
          data: data.map((r) => {
            const point = [Number(r[xField]) || 0, Number(r[yField]) || 0];
            if (sizeField) point.push(Number(r[sizeField]) || 10);
            return {
              value: point,
              name: labelField ? r[labelField] : undefined,
            };
          }),
          symbolSize: sizeField
            ? (val) => Math.max(6, Math.min(40, val[2] / 5))
            : 8,
          tooltip: {
            formatter: (p) =>
              labelField ? `${p.data.name}<br/>${xField}: ${p.value[0]}<br/>${yField}: ${p.value[1]}` : undefined,
          },
        }],
      };
    }

    if (!xField || !yField) return empty;
    const xData = data.map((r) => r[xField]);
    const yData = data.map((r) => Number(r[yField]) || 0);

    return {
      ...base,
      xAxis: {
        type: 'category', data: xData,
        axisLabel: { rotate: xData.length > 8 ? 30 : 0, fontSize: 11, interval: 'auto' },
      },
      yAxis: { type: 'value' },
      series: [{
        type: chartType === 'area' ? 'line' : chartType,
        data: yData,
        areaStyle: chartType === 'area' ? { opacity: 0.25 } : undefined,
        smooth: chartType === 'line' || chartType === 'area',
        itemStyle: { color: COLORS[0] },
        barMaxWidth: 60,
      }],
    };
  }, [data, config]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />
      </div>
    </div>
  );
}
