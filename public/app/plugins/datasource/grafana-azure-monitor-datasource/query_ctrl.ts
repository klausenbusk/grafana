import _ from 'lodash';
import { QueryCtrl } from 'app/plugins/sdk';
import TimegrainConverter from './time_grain_converter';
import './editor/editor_component';

import { TemplateSrv } from '@grafana/runtime';
import { auto } from 'angular';
import { DataFrame, PanelEvents } from '@grafana/data';
import { AzureQueryType, AzureMetricQuery, AzureMonitorQuery } from './types';
import { convertTimeGrainsToMs } from './utils/common';
import Datasource from './datasource';

export interface ResultFormat {
  text: string;
  value: string;
}

export class AzureMonitorQueryCtrl extends QueryCtrl {
  static templateUrl = 'partials/query.editor.html';

  defaultDropdownValue = 'select';

  dummyDiminsionString = '+';

  queryQueryTypeOptions = [
    { id: AzureQueryType.AzureMonitor, label: 'Metrics' },
    { id: AzureQueryType.LogAnalytics, label: 'Logs' },
    { id: AzureQueryType.ApplicationInsights, label: 'Application Insights' },
    { id: AzureQueryType.InsightsAnalytics, label: 'Insights Analytics' },
  ];

  // Query types that have been migrated to React
  reactQueryEditors = [AzureQueryType.AzureMonitor, AzureQueryType.LogAnalytics];

  // target: AzureMonitorQuery;

  declare target: {
    // should be: AzureMonitorQuery
    refId: string;
    queryType: AzureQueryType;
    subscription: string;
    azureMonitor: AzureMetricQuery;
    azureLogAnalytics: {
      query: string;
      resultFormat: string;
      workspace: string;
    };
    appInsights: {
      // metric style query when rawQuery == false
      metricName: string;
      dimension: any;
      dimensionFilter: string;
      dimensions: string[];

      aggOptions: string[];
      aggregation: string;

      timeGrainType: string;
      timeGrainCount: string;
      timeGrainUnit: string;
      timeGrain: string;
      timeGrains: Array<{ text: string; value: string }>;
      allowedTimeGrainsMs: number[];
    };
    insightsAnalytics: {
      query: any;
      resultFormat: string;
    };
  };

  defaults = {
    queryType: 'Azure Monitor',
    azureMonitor: {
      resourceGroup: undefined,
      metricDefinition: undefined,
      resourceName: undefined,
      metricNamespace: undefined,
      metricName: undefined,
      dimensionFilter: '*',
      timeGrain: 'auto',
      top: '10',
      aggOptions: [] as string[],
      timeGrains: [] as string[],
    },
    azureLogAnalytics: {
      query: [
        '//change this example to create your own time series query',
        '<table name>                                                              ' +
          '//the table to query (e.g. Usage, Heartbeat, Perf)',
        '| where $__timeFilter(TimeGenerated)                                      ' +
          '//this is a macro used to show the full chart’s time range, choose the datetime column here',
        '| summarize count() by <group by column>, bin(TimeGenerated, $__interval) ' +
          '//change “group by column” to a column in your table, such as “Computer”. ' +
          'The $__interval macro is used to auto-select the time grain. Can also use 1h, 5m etc.',
        '| order by TimeGenerated asc',
      ].join('\n'),
      resultFormat: 'time_series',
      workspace:
        this.datasource && this.datasource.azureLogAnalyticsDatasource
          ? this.datasource.azureLogAnalyticsDatasource.defaultOrFirstWorkspace
          : '',
    },
    appInsights: {
      metricName: this.defaultDropdownValue,
      // dimension: [],
      timeGrain: 'auto',
    },
    insightsAnalytics: {
      query: '',
      resultFormat: 'time_series',
    },
  };

  resultFormats: ResultFormat[];
  workspaces: any[];
  showHelp: boolean;
  showLastQuery: boolean;
  lastQuery: string;
  lastQueryError?: string;
  subscriptions: Array<{ text: string; value: string }>;

  /** @ngInject */
  constructor($scope: any, $injector: auto.IInjectorService, private templateSrv: TemplateSrv) {
    super($scope, $injector);

    _.defaultsDeep(this.target, this.defaults);

    this.migrateTimeGrains();

    this.migrateToFromTimes();

    this.migrateToDefaultNamespace();

    this.migrateApplicationInsightsKeys();

    this.migrateApplicationInsightsDimensions();

    migrateMetricsDimensionFilters(this.target.azureMonitor);

    this.panelCtrl.events.on(PanelEvents.dataReceived, this.onDataReceived.bind(this), $scope);
    this.panelCtrl.events.on(PanelEvents.dataError, this.onDataError.bind(this), $scope);
    this.resultFormats = [
      { text: 'Time series', value: 'time_series' },
      { text: 'Table', value: 'table' },
    ];
    this.getSubscriptions();
    if (this.target.queryType === 'Azure Log Analytics') {
      this.getWorkspaces();
    }
  }

  onDataReceived(dataList: DataFrame[]) {
    this.lastQueryError = undefined;
    this.lastQuery = '';

    const anySeriesFromQuery: any = _.find(dataList, { refId: this.target.refId });
    if (anySeriesFromQuery && anySeriesFromQuery.meta) {
      this.lastQuery = anySeriesFromQuery.meta.query;
    }
  }

  onDataError(err: any) {
    this.handleQueryCtrlError(err);
  }

  handleQueryCtrlError(err: any) {
    if (err.query && err.query.refId && err.query.refId !== this.target.refId) {
      return;
    }

    if (err.error && err.error.data && err.error.data.error && err.error.data.error.innererror) {
      if (err.error.data.error.innererror.innererror) {
        this.lastQueryError = err.error.data.error.innererror.innererror.message;
      } else {
        this.lastQueryError = err.error.data.error.innererror.message;
      }
    } else if (err.error && err.error.data && err.error.data.error) {
      this.lastQueryError = err.error.data.error.message;
    } else if (err.error && err.error.data) {
      this.lastQueryError = err.error.data.message;
    } else if (err.data && err.data.error) {
      this.lastQueryError = err.data.error.message;
    } else if (err.data && err.data.message) {
      this.lastQueryError = err.data.message;
    } else {
      this.lastQueryError = err;
    }
  }

  migrateTimeGrains() {
    if (this.target.azureMonitor.timeGrainUnit) {
      if (this.target.azureMonitor.timeGrain !== 'auto') {
        this.target.azureMonitor.timeGrain = TimegrainConverter.createISO8601Duration(
          this.target.azureMonitor.timeGrain,
          this.target.azureMonitor.timeGrainUnit
        );
      }

      delete this.target.azureMonitor.timeGrainUnit;
    }

    if (this.target.appInsights.timeGrainUnit) {
      if (this.target.appInsights.timeGrain !== 'auto') {
        if (this.target.appInsights.timeGrainCount) {
          this.target.appInsights.timeGrain = TimegrainConverter.createISO8601Duration(
            this.target.appInsights.timeGrainCount,
            this.target.appInsights.timeGrainUnit
          );
        } else {
          this.target.appInsights.timeGrainCount = this.target.appInsights.timeGrain;
          this.target.appInsights.timeGrain = TimegrainConverter.createISO8601Duration(
            this.target.appInsights.timeGrain,
            this.target.appInsights.timeGrainUnit
          );
        }
      }
    }

    const oldAzureTimeGrains = (this.target.azureMonitor as any).timeGrains;
    if (
      oldAzureTimeGrains &&
      oldAzureTimeGrains.length > 0 &&
      (!this.target.azureMonitor.allowedTimeGrainsMs || this.target.azureMonitor.allowedTimeGrainsMs.length === 0)
    ) {
      this.target.azureMonitor.allowedTimeGrainsMs = convertTimeGrainsToMs(oldAzureTimeGrains);
    }

    if (
      this.target.appInsights.timeGrains &&
      this.target.appInsights.timeGrains.length > 0 &&
      (!this.target.appInsights.allowedTimeGrainsMs || this.target.appInsights.allowedTimeGrainsMs.length === 0)
    ) {
      this.target.appInsights.allowedTimeGrainsMs = convertTimeGrainsToMs(this.target.appInsights.timeGrains);
    }
  }

  migrateToFromTimes() {
    this.target.azureLogAnalytics.query = this.target.azureLogAnalytics.query.replace(/\$__from\s/gi, '$__timeFrom() ');
    this.target.azureLogAnalytics.query = this.target.azureLogAnalytics.query.replace(/\$__to\s/gi, '$__timeTo() ');
  }

  async migrateToDefaultNamespace() {
    if (
      this.target.azureMonitor.metricNamespace &&
      this.target.azureMonitor.metricNamespace !== this.defaultDropdownValue &&
      this.target.azureMonitor.metricDefinition
    ) {
      return;
    }

    this.target.azureMonitor.metricNamespace = this.target.azureMonitor.metricDefinition;
  }

  migrateApplicationInsightsKeys(): void {
    const appInsights = this.target.appInsights as any;

    // Migrate old app insights data keys to match other datasources
    const mappings = {
      xaxis: 'timeColumn',
      yaxis: 'valueColumn',
      spliton: 'segmentColumn',
      groupBy: 'dimension',
      groupByOptions: 'dimensions',
      filter: 'dimensionFilter',
    } as { [old: string]: string };

    for (const old in mappings) {
      if (appInsights[old]) {
        appInsights[mappings[old]] = appInsights[old];
        delete appInsights[old];
      }
    }
  }

  migrateApplicationInsightsDimensions() {
    const { appInsights } = this.target;

    if (!appInsights.dimension) {
      appInsights.dimension = [];
    }

    if (_.isString(appInsights.dimension)) {
      appInsights.dimension = [appInsights.dimension as string];
    }
  }

  replace = (variable: string) => {
    return this.templateSrv.replace(variable, this.panelCtrl.panel.scopedVars);
  };

  onQueryTypeChange() {
    if (this.target.queryType === 'Azure Log Analytics') {
      return this.getWorkspaces();
    }
  }

  getSubscriptions() {
    if (!this.datasource.azureMonitorDatasource.isConfigured()) {
      return;
    }

    // assert the type
    if (!(this.datasource instanceof Datasource)) {
      return;
    }

    return this.datasource.azureMonitorDatasource.getSubscriptions().then((subscriptions) => {
      // We changed the format in the datasource for the new react stuff, so here we change it back
      const subs = subscriptions.map((v) => ({
        text: `${v.text} - ${v.value}`,
        value: v.value,
      }));

      this.subscriptions = subs;
      if (!this.target.subscription && this.target.queryType === 'Azure Monitor') {
        this.target.subscription = this.datasource.azureMonitorDatasource.subscriptionId;
      } else if (!this.target.subscription && this.target.queryType === 'Azure Log Analytics') {
        this.target.subscription = this.datasource.azureLogAnalyticsDatasource.logAnalyticsSubscriptionId;
      }

      if (!this.target.subscription && this.subscriptions.length > 0) {
        this.target.subscription = this.subscriptions[0].value;
      }

      return this.subscriptions;
    });
  }

  onSubscriptionChange() {
    if (this.target.queryType === 'Azure Log Analytics') {
      return this.getWorkspaces();
    }
  }

  generateAutoUnits(timeGrain: string, timeGrains: Array<{ value: string }>) {
    if (timeGrain === 'auto') {
      return TimegrainConverter.findClosestTimeGrain(
        '1m',
        _.map(timeGrains, (o) => TimegrainConverter.createKbnUnitFromISO8601Duration(o.value)) || [
          '1m',
          '5m',
          '15m',
          '30m',
          '1h',
          '6h',
          '12h',
          '1d',
        ]
      );
    }

    return '';
  }

  getAzureMonitorAutoInterval() {
    return this.generateAutoUnits(this.target.azureMonitor.timeGrain, (this.target.azureMonitor as any).timeGrains);
  }

  getApplicationInsightAutoInterval() {
    return this.generateAutoUnits(this.target.appInsights.timeGrain, this.target.appInsights.timeGrains);
  }

  azureMonitorAddDimensionFilter() {
    this.target.azureMonitor.dimensionFilters.push({
      dimension: '',
      operator: 'eq',
      filter: '',
    });
  }

  azureMonitorRemoveDimensionFilter(index: number) {
    this.target.azureMonitor.dimensionFilters.splice(index, 1);
    this.refresh();
  }

  /* Azure Log Analytics */

  getWorkspaces = () => {
    return this.datasource.azureLogAnalyticsDatasource
      .getWorkspaces(this.target.subscription)
      .then((list: any[]) => {
        this.workspaces = list;

        if (list.length > 0 && !this.target.azureLogAnalytics.workspace) {
          if (this.datasource.azureLogAnalyticsDatasource.defaultOrFirstWorkspace) {
            this.target.azureLogAnalytics.workspace = this.datasource.azureLogAnalyticsDatasource.defaultOrFirstWorkspace;
          }

          if (!this.target.azureLogAnalytics.workspace) {
            this.target.azureLogAnalytics.workspace = list[0].value;
          }
        }

        return this.workspaces;
      })
      .catch(this.handleQueryCtrlError.bind(this));
  };

  getAzureLogAnalyticsSchema = () => {
    return this.getWorkspaces()
      .then(() => {
        return this.datasource.azureLogAnalyticsDatasource.getSchema(this.target.azureLogAnalytics.workspace);
      })
      .catch(this.handleQueryCtrlError.bind(this));
  };

  onLogAnalyticsQueryChange = (nextQuery: string) => {
    this.target.azureLogAnalytics.query = nextQuery;
  };

  onLogAnalyticsQueryExecute = () => {
    this.panelCtrl.refresh();
  };

  get templateVariables() {
    return this.templateSrv.getVariables().map((t) => '$' + t.name);
  }

  getAppInsightsMetricNames() {
    if (!this.datasource.appInsightsDatasource.isConfigured()) {
      return;
    }

    return this.datasource.getAppInsightsMetricNames().catch(this.handleQueryCtrlError.bind(this));
  }

  getAppInsightsColumns() {
    return this.datasource.getAppInsightsColumns(this.target.refId);
  }

  onAppInsightsColumnChange() {
    return this.refresh();
  }

  onAppInsightsMetricNameChange() {
    if (!this.target.appInsights.metricName || this.target.appInsights.metricName === this.defaultDropdownValue) {
      return;
    }

    return this.datasource
      .getAppInsightsMetricMetadata(this.replace(this.target.appInsights.metricName))
      .then((aggData: { supportedAggTypes: string[]; supportedGroupBy: string[]; primaryAggType: string }) => {
        this.target.appInsights.aggOptions = aggData.supportedAggTypes;
        this.target.appInsights.dimensions = aggData.supportedGroupBy;
        this.target.appInsights.aggregation = aggData.primaryAggType;
        return this.refresh();
      })
      .catch(this.handleQueryCtrlError.bind(this));
  }

  onInsightsAnalyticsQueryChange = (nextQuery: string) => {
    this.target.insightsAnalytics.query = nextQuery;
  };

  onQueryExecute = () => {
    return this.refresh();
  };

  getAppInsightsQuerySchema = () => {
    return this.datasource.appInsightsDatasource.getQuerySchema().catch(this.handleQueryCtrlError.bind(this));
  };

  removeGroupBy = (index: number) => {
    const { appInsights } = this.target;
    appInsights.dimension.splice(index, 1);
    this.refresh();
  };

  getAppInsightsGroupBySegments(query: any) {
    const { appInsights } = this.target;

    // HACK alert... there must be a better way!
    if (this.dummyDiminsionString && this.dummyDiminsionString.length && '+' !== this.dummyDiminsionString) {
      if (!appInsights.dimension) {
        appInsights.dimension = [];
      }
      appInsights.dimension.push(this.dummyDiminsionString);
      this.dummyDiminsionString = '+';
      this.refresh();
    }

    // Return the list of dimensions stored on the query object from the last request :(
    return _.map(appInsights.dimensions, (option: string) => {
      return { text: option, value: option };
    });
  }

  resetAppInsightsGroupBy() {
    this.target.appInsights.dimension = 'none';
    this.refresh();
  }

  updateTimeGrainType() {
    if (this.target.appInsights.timeGrainType === 'specific') {
      this.target.appInsights.timeGrainCount = '1';
      this.target.appInsights.timeGrainUnit = 'minute';
      this.target.appInsights.timeGrain = TimegrainConverter.createISO8601Duration(
        this.target.appInsights.timeGrainCount,
        this.target.appInsights.timeGrainUnit
      );
    } else {
      this.target.appInsights.timeGrainCount = '';
      this.target.appInsights.timeGrainUnit = '';
    }
  }

  updateAppInsightsTimeGrain() {
    if (this.target.appInsights.timeGrainUnit && this.target.appInsights.timeGrainCount) {
      this.target.appInsights.timeGrain = TimegrainConverter.createISO8601Duration(
        this.target.appInsights.timeGrainCount,
        this.target.appInsights.timeGrainUnit
      );
    }
    this.refresh();
  }

  /**
   * Receives a full new query object from React and updates it into the Angular controller
   */
  handleNewQuery = (newQuery: AzureMonitorQuery) => {
    Object.assign(this.target, newQuery);
    this.refresh();
  };
}

// Modifies the actual query object
export function migrateMetricsDimensionFilters(item: AzureMetricQuery) {
  if (!item.dimensionFilters) {
    item.dimensionFilters = [];
  }
  const oldDimension = (item as any).dimension;
  if (oldDimension && oldDimension !== 'None') {
    item.dimensionFilters.push({
      dimension: oldDimension,
      operator: 'eq',
      filter: (item as any).dimensionFilter,
    });
    delete (item as any).dimension;
    delete (item as any).dimensionFilter;
  }
}
