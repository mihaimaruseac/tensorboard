/* Copyright 2020 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
import {Injectable} from '@angular/core';
import {Actions, createEffect, ofType, OnInitEffects} from '@ngrx/effects';
import {Action, createAction, createSelector, Store} from '@ngrx/store';
import {forkJoin, merge, Observable, of} from 'rxjs';
import {
  catchError,
  filter,
  map,
  mergeMap,
  switchMap,
  take,
  tap,
  withLatestFrom,
} from 'rxjs/operators';

import * as routingActions from '../../app_routing/actions';
import {stateRehydratedFromUrl} from '../../app_routing/actions';
import {RouteKind} from '../../app_routing/types';
import {State} from '../../app_state';
import * as coreActions from '../../core/actions';
import {getActivePlugin} from '../../core/store';
import * as selectors from '../../selectors';
import {DataLoadState} from '../../types/data';
import * as actions from '../actions';
import {
  isFailedTimeSeriesResponse,
  isSingleRunPlugin,
  MetricsDataSource,
  METRICS_PLUGIN_ID,
  PersistableSettings,
  TagMetadata,
  TimeSeriesRequest,
  TimeSeriesResponse,
} from '../data_source/index';
import {
  getCardLoadState,
  getCardMetadata,
  getMetricsIgnoreOutliers,
  getMetricsScalarSmoothing,
  getMetricsTagMetadataLoaded,
  getMetricsTooltipSort,
} from '../store';
import {CardId, CardMetadata, URLDeserializedState} from '../types';

/** @typehack */ import * as _typeHackNgrxEffects from '@ngrx/effects';
/** @typehack */ import * as _typeHackModels from '@ngrx/store/src/models';
/** @typehack */ import * as _typeHackStore from '@ngrx/store';

export type CardFetchInfo = CardMetadata & {
  id: CardId;
  loadState: DataLoadState;
};

const getCardFetchInfo = createSelector(getCardLoadState, getCardMetadata, (
  loadState,
  maybeMetadata,
  cardId /* props */
): CardFetchInfo | null => {
  if (!maybeMetadata) {
    return null;
  }
  return {...maybeMetadata, loadState, id: cardId};
});

const initAction = createAction('[Metrics Effects] Init');

@Injectable()
export class MetricsEffects implements OnInitEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly store: Store<State>,
    private readonly dataSource: MetricsDataSource
  ) {}

  /** @export */
  ngrxOnInitEffects(): Action {
    return initAction();
  }

  /**
   * Our effects react when the plugin dashboard is fully "shown" and experiment
   * ids are available. The `activePlugin` acts as our proxy to know whether it
   * is shown.
   *
   * [Metrics Effects] Init  - the initial `activePlugin` is set.
   * [Core] Plugin Changed   - subsequent `activePlugin` updates.
   * [App Routing] Navigated - experiment id updates.
   */
  private readonly dashboardShownWithoutData$ = this.actions$.pipe(
    ofType(initAction, coreActions.changePlugin, routingActions.navigated),
    withLatestFrom(
      this.store.select(getActivePlugin),
      this.store.select(getMetricsTagMetadataLoaded)
    ),
    filter(([, activePlugin, tagLoadState]) => {
      return (
        activePlugin === METRICS_PLUGIN_ID &&
        tagLoadState === DataLoadState.NOT_LOADED
      );
    })
  );

  private readonly reloadRequestedWhileShown$ = this.actions$.pipe(
    ofType(coreActions.reload, coreActions.manualReload),
    withLatestFrom(this.store.select(getActivePlugin)),
    filter(([, activePlugin]) => {
      return activePlugin === METRICS_PLUGIN_ID;
    })
  );

  private readonly loadTagMetadata$ = merge(
    this.dashboardShownWithoutData$,
    this.reloadRequestedWhileShown$
  ).pipe(
    withLatestFrom(
      this.store.select(getMetricsTagMetadataLoaded),
      this.store.select(selectors.getExperimentIdsFromRoute)
    ),
    filter(([, tagLoadState, experimentIds]) => {
      /**
       * When `experimentIds` is null, the actual ids have not
       * appeared in the store yet.
       */
      return tagLoadState !== DataLoadState.LOADING && experimentIds !== null;
    }),
    tap(() => {
      this.store.dispatch(actions.metricsTagMetadataRequested());
    }),
    switchMap(([, , experimentIds]) => {
      return this.dataSource.fetchTagMetadata(experimentIds!).pipe(
        tap((tagMetadata: TagMetadata) => {
          this.store.dispatch(actions.metricsTagMetadataLoaded({tagMetadata}));
        }),
        catchError(() => {
          this.store.dispatch(actions.metricsTagMetadataFailed());
          return of(null);
        })
      );
    })
  );

  private getVisibleCardFetchInfos(): Observable<CardFetchInfo[]> {
    const visibleCardIds$ = this.store.select(selectors.getVisibleCardIdSet);
    return visibleCardIds$.pipe(
      switchMap((cardIds) => {
        // Explicitly notify subscribers that there are no visible cards,
        // since `forkJoin` does not emit when passed an empty array.
        if (!cardIds.size) {
          return of([]);
        }
        const observables = [...cardIds].map((cardId) => {
          return this.store.select(getCardFetchInfo, cardId).pipe(take(1));
        });
        return forkJoin(observables);
      }),
      map((fetchInfos) => {
        return fetchInfos.filter(Boolean) as CardFetchInfo[];
      })
    );
  }

  private fetchTimeSeries(request: TimeSeriesRequest) {
    return this.dataSource.fetchTimeSeries([request]).pipe(
      tap((responses: TimeSeriesResponse[]) => {
        const errors = responses.filter(isFailedTimeSeriesResponse);
        if (errors.length) {
          console.error('Time series response contained errors:', errors);
        }
        this.store.dispatch(
          actions.fetchTimeSeriesLoaded({response: responses[0]})
        );
      }),
      catchError(() => {
        this.store.dispatch(actions.fetchTimeSeriesFailed({request}));
        return of(null);
      })
    );
  }

  private fetchTimeSeriesForCards(
    fetchInfos: CardFetchInfo[],
    experimentIds: string[]
  ) {
    /**
     * TODO(psybuzz): if 2 cards require the same data, we should dedupe instead of
     * making 2 identical requests.
     */
    const requests: TimeSeriesRequest[] = fetchInfos.map((fetchInfo) => {
      const {plugin, tag, runId, sample} = fetchInfo;
      return isSingleRunPlugin(plugin)
        ? {plugin, tag, sample, runId: runId!}
        : {plugin, tag, sample, experimentIds};
    });

    // Fetch and handle responses.
    return of(requests).pipe(
      tap((requests) => {
        this.store.dispatch(actions.multipleTimeSeriesRequested({requests}));
      }),
      mergeMap((requests: TimeSeriesRequest[]) => {
        const observables = requests.map((request) =>
          this.fetchTimeSeries(request)
        );
        return merge(...observables);
      })
    );
  }

  private readonly visibleCardsWithoutDataChanged$ = this.actions$.pipe(
    ofType(actions.cardVisibilityChanged),
    switchMap(() => this.getVisibleCardFetchInfos().pipe(take(1))),
    map((fetchInfos) => {
      return fetchInfos.filter((fetchInfo) => {
        return fetchInfo.loadState === DataLoadState.NOT_LOADED;
      });
    })
  );

  private readonly visibleCardsReloaded$ = this.reloadRequestedWhileShown$.pipe(
    switchMap(() => this.getVisibleCardFetchInfos().pipe(take(1))),
    map((fetchInfos) => {
      return fetchInfos.filter((fetchInfo) => {
        return fetchInfo.loadState !== DataLoadState.LOADING;
      });
    })
  );

  private readonly loadTimeSeries$ = merge(
    this.visibleCardsWithoutDataChanged$,
    this.visibleCardsReloaded$
  ).pipe(
    filter((fetchInfos) => fetchInfos.length > 0),

    // Ignore card visibility events until we have non-null
    // experimentIds.
    withLatestFrom(
      this.store
        .select(selectors.getExperimentIdsFromRoute)
        .pipe(filter((experimentIds) => experimentIds !== null))
    ),
    mergeMap(([fetchInfos, experimentIds]) => {
      return this.fetchTimeSeriesForCards(fetchInfos, experimentIds!);
    })
  );

  /**
   * In general, this effect dispatch the following actions:
   *
   * On dashboard shown with visible cards:
   * - metricsTagMetadataRequested
   * - multipleTimeSeriesRequested
   *
   * On reloads:
   * - metricsTagMetadataRequested
   * - multipleTimeSeriesRequested
   *
   * On data source responses:
   * - metricsTagMetadataLoaded
   * - metricsTagMetadataFailed
   * - fetchTimeSeriesLoaded
   * - fetchTimeSeriesFailed
   */
  /** @export */
  readonly dataEffects$ = createEffect(
    () => {
      return merge(
        /**
         * Subscribes to: dashboard shown, route navigation, reloads.
         */
        this.loadTagMetadata$,

        /**
         * Subscribes to: card visibility, reloads.
         */
        this.loadTimeSeries$
      );
    },
    {dispatch: false}
  );

  /** @export */
  readonly setSettingsToStorage$: Observable<void> = createEffect(
    () => {
      return merge(
        this.actions$.pipe(
          ofType(actions.metricsChangeScalarSmoothing),
          withLatestFrom(this.store.select(getMetricsScalarSmoothing)),
          map(([, scalarSmoothing]) => ({scalarSmoothing}))
        ),
        // The smoothing value is persisted both in URL and global setting.
        // Since we want URL one to take precedence over the global setting,
        // when the URL contains the smoothing, we write the values in the URL
        // into LocalStorage. This is so that user does not get confused when
        // they manually specify smoothing value in URL then remove it. To
        // elaborate on this, imagine below:
        // 1. user drags smoothing to set it to 0.5 and persist it.
        // 2. user opens a URL (from bookmark) or manually reset smoothing to 0
        //    with `/?smoothing=0`. TensorBoard shows smoothing=0.
        // 3. user removes `?smoothing=0` from URL. Without below, TensorBoard
        //    will show 0.5 which can be very surprising. With below, it is now
        //    0, your last TensorBoard value.
        this.actions$.pipe(
          ofType(stateRehydratedFromUrl),
          filter(({routeKind}) => {
            return (
              routeKind === RouteKind.EXPERIMENT ||
              routeKind === RouteKind.COMPARE_EXPERIMENT
            );
          }),
          map(({partialState}) => {
            return partialState as URLDeserializedState;
          }),
          filter((partialState) => {
            const hydratedSmoothing = partialState.metrics.smoothing;
            return Number.isFinite(hydratedSmoothing);
          }),
          withLatestFrom(this.store.select(getMetricsScalarSmoothing)),
          map(([, scalarSmoothing]) => ({scalarSmoothing}))
        ),
        this.actions$.pipe(
          ofType(actions.metricsChangeTooltipSort),
          withLatestFrom(this.store.select(getMetricsTooltipSort)),
          map(([, tooltipSort]) => ({tooltipSort}))
        ),
        this.actions$.pipe(
          ofType(actions.metricsToggleIgnoreOutliers),
          withLatestFrom(this.store.select(getMetricsIgnoreOutliers)),
          map(([, ignoreOutliers]) => ({ignoreOutliers}))
        )
      ).pipe(
        switchMap((partialSetting: Partial<PersistableSettings>) => {
          return this.dataSource.setSettings(partialSetting);
        })
      );
    },
    {dispatch: false}
  );

  /** @export */
  readonly readSettingsFromStorage$: Observable<Action> = createEffect(() => {
    return this.actions$.pipe(
      ofType(initAction),
      switchMap(() => this.dataSource.getSettings()),
      map((partialSettings) =>
        actions.fetchPersistedSettingsSucceeded({partialSettings})
      )
    );
  });
}

export const TEST_ONLY = {
  getCardFetchInfo,
  initAction,
};
