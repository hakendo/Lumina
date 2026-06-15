import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';

// Paleta tierra/luz acorde al design system de Lúmina
const COLORS = ['#b8730f', '#16695f', '#b3401f', '#3f6493', '#7d8030', '#8a4d76', '#d9a441', '#5c7d9a'];
const INK_SOFT = '#5c5547';
const INK_FAINT = '#968d7b';
const LINE = '#e9e3d5';
const MONO = '"Spline Sans Mono", monospace';
const SANS = '"Hanken Grotesk", sans-serif';

export default function ChartWidget({ config, data, onCrossFilter }) {
  const { chartType = 'bar', xField, yField, sizeField, labelField, title } = config;

  const option = useMemo(() => {
    const empty = {
      title: {
        text: title || 'Sin datos',
        left: 'center', top: 'middle',
        textStyle: { color: INK_FAINT, fontSize: 13, fontFamily: SANS, fontWeight: 400 },
      },
    };

    if (!data?.length) return empty;

    const base = {
      textStyle: { fontFamily: SANS },
      tooltip: {
        trigger: chartType === 'scatter' ? 'item' : 'axis',
        backgroundColor: '#fdfbf6',
        borderColor: LINE,
        textStyle: { color: INK_SOFT, fontSize: 12, fontFamily: MONO },
      },
      color: COLORS,
      grid: { left: 48, right: 16, top: title ? 36 : 16, bottom: 36 },
      ...(title && {
        title: { text: title, textStyle: { fontSize: 12, fontWeight: 600, color: INK_SOFT, fontFamily: SANS }, top: 4, left: 8 },
      }),
    };

    const axisStyle = {
      axisLine: { lineStyle: { color: LINE } },
      axisLabel: { color: INK_FAINT, fontSize: 11, fontFamily: MONO },
      splitLine: { lineStyle: { color: LINE } },
    };

    if (chartType === 'pie') {
      if (!xField || !yField) return empty;
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          data: data.map((r) => ({ name: r[xField], value: Number(r[yField]) || 0 })),
          label: { show: true, formatter: '{b}\n{d}%', fontSize: 11, color: INK_SOFT, fontFamily: SANS },
          itemStyle: { borderColor: '#fdfbf6', borderWidth: 2 },
        }],
      };
    }

    if (chartType === 'scatter') {
      if (!xField || !yField) return empty;
      return {
        ...base,
        xAxis: { type: 'value', name: xField, nameTextStyle: { fontSize: 11, color: INK_FAINT }, ...axisStyle },
        yAxis: { type: 'value', name: yField, nameTextStyle: { fontSize: 11, color: INK_FAINT }, ...axisStyle },
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
          itemStyle: { opacity: 0.85 },
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
        ...axisStyle,
        axisLabel: { ...axisStyle.axisLabel, rotate: xData.length > 8 ? 30 : 0, interval: 'auto' },
      },
      yAxis: { type: 'value', ...axisStyle },
      series: [{
        type: chartType === 'area' ? 'line' : chartType,
        data: yData,
        areaStyle: chartType === 'area' ? { opacity: 0.2 } : undefined,
        smooth: chartType === 'line' || chartType === 'area',
        itemStyle: { color: COLORS[0], borderRadius: chartType === 'bar' ? [3, 3, 0, 0] : undefined },
        lineStyle: { width: 2.5 },
        barMaxWidth: 60,
      }],
    };
  }, [data, config]);

  const onEvents = onCrossFilter && xField
    ? {
        click: (params) => {
          const value = params.name ?? params.data?.name ?? params.value;
          if (value !== undefined) onCrossFilter(xField, value);
        },
      }
    : undefined;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          notMerge
          onEvents={onEvents}
        />
      </div>
    </div>
  );
}
