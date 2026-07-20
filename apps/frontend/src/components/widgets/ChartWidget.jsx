import ReactEChartsCore from 'echarts-for-react/esm/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useMemo } from 'react';
import { useDatasetMeta, WidgetFooter } from './useDatasetMeta';
import { formatDateValue } from '../../lib/dateFormat';

echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);

const COLORS = ['#133896', '#08cdff', '#031560', '#157a52', '#b3222f', '#5c6b84', '#7a9cc6', '#0a5c8a'];
const INK_SOFT = '#444444';
const INK_FAINT = '#838da0';
const LINE = '#cfd3d9';
const MONO = '"Spline Sans Mono", monospace';
const SANS = '"Nunito Sans", sans-serif';

export default function ChartWidget({ config, data, onCrossFilter, datasetId }) {
  const { chartType = 'bar', xField, yField, sizeField, labelField, title, dateFormat } = config;
  const displayX = (v) => (dateFormat ? formatDateValue(v, dateFormat) : v);
  const meta = useDatasetMeta(datasetId);

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
        backgroundColor: '#ffffff',
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
          data: data.map((r) => ({ name: displayX(r[xField]), value: Number(r[yField]) || 0 })),
          label: { show: true, formatter: '{b}\n{d}%', fontSize: 11, color: INK_SOFT, fontFamily: SANS },
          itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
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
            return { value: point, name: labelField ? r[labelField] : undefined };
          }),
          symbolSize: sizeField ? (val) => Math.max(6, Math.min(40, val[2] / 5)) : 8,
          itemStyle: { opacity: 0.85 },
          tooltip: {
            formatter: (p) =>
              labelField ? `${p.data.name}<br/>${xField}: ${p.value[0]}<br/>${yField}: ${p.value[1]}` : undefined,
          },
        }],
      };
    }

    if (!xField || !yField) return empty;
    const xData = data.map((r) => displayX(r[xField]));
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
          // Use the raw row value (not the possibly date-formatted display label)
          // so cross-filtering still matches the underlying data.
          const raw = data?.[params.dataIndex]?.[xField];
          const value = raw ?? params.name ?? params.data?.name ?? params.value;
          if (value !== undefined) onCrossFilter(xField, value);
        },
      }
    : undefined;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ height: '100%', width: '100%' }}
          notMerge
          onEvents={onEvents}
        />
      </div>
      <WidgetFooter dataCount={data?.length} dataLabel="puntos" meta={meta} />
    </div>
  );
}
