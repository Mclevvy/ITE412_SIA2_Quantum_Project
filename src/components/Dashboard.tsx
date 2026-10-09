import { Card, CardContent } from "./ui/card";
import Logo from "./Logo";
import { useDashboardLive } from "../hooks/useDashboardLive";
import { useBatchActions } from "../hooks/useBatchActions";
import { AbvHero } from "./dashboard/AbvHero";
import { ControlCards } from "./dashboard/ControlCards";
import { SensorCards } from "./dashboard/SensorCards";
import { BatchModals } from "./dashboard/BatchModals";

interface DashboardProps {
  userRole: string;
}

/**
 * Dashboard shell: composes the live-data hook, batch-action hook, and
 * presentational panels. All subscriptions live in useDashboardLive, all
 * writes + dialog state in useBatchActions, all JSX in ./dashboard/.
 */
export default function Dashboard({ userRole }: DashboardProps) {
  void userRole;
  const live = useDashboardLive();
  const actions = useBatchActions(live);

  if (!live.dbReady) {
    return (
      <div className="p-4">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-sm text-red-700 font-medium">Realtime Database not available</p>
            <p className="text-xs text-red-600 mt-1">Check your src/lib/firebase.ts configuration.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-2 pt-1">
        <Logo size="xl" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-primary/70">Bunius-Sense</p>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Dashboard</h1>
        </div>
      </div>

      {/* ALCOHOL HERO — dark wine card */}
      <AbvHero
        estimatedAbv={live.estimatedAbv}
        ogBrixForCheck={live.ogBrixForCheck}
        brixAboveOg={live.brixAboveOg}
        updatedAt={live.updatedAt}
        isBatchActive={live.isBatchActive}
        lastHydroCheck={live.lastHydroCheck}
        onLogCheck={() => actions.setIsHydroModalOpen(true)}
      />

      {/* BATCH CONTROL + OG CORRECTION + STATUS + NOTICE */}
      <ControlCards
        isBatchActive={live.isBatchActive}
        activeBatchId={live.activeBatchId}
        ogBrixForCheck={live.ogBrixForCheck}
        brixAboveOg={live.brixAboveOg}
        isOgEditing={actions.isOgEditing}
        ogInput={actions.ogInput}
        setOgInput={actions.setOgInput}
        setIsOgEditing={actions.setIsOgEditing}
        onOpenStart={() => actions.setIsStartModalOpen(true)}
        onOpenStop={() => actions.setIsStopModalOpen(true)}
        onSaveOg={actions.handleSaveOg}
      />

      {/* SENSOR READINGS */}
      <SensorCards
        isBatchActive={live.isBatchActive}
        tempNow={live.tempNow}
        pressureNow={live.pressureNow}
        brixNow={live.brixNow}
        brixSource={live.brixSource}
        phNow={live.phNow}
        tempStatus={live.tempStatus}
        brixStatus={live.brixStatus}
        phStatus={live.phStatus}
        pressureStatus={live.pressureStatus}
        temperatureData={live.temperatureData}
        pressureData={live.pressureData}
        sugarData={live.sugarData}
        phData={live.phData}
        finishTargetBrix={live.finishTargetBrix}
        daysSinceSugarTest={live.daysSinceSugarTest}
        sugarTestDue={live.sugarTestDue}
        onLogSugar={() => actions.setIsSugarModalOpen(true)}
      />

      {/* MODALS */}
      <BatchModals
        isStartModalOpen={actions.isStartModalOpen}
        setIsStartModalOpen={actions.setIsStartModalOpen}
        newBatch={actions.newBatch}
        setNewBatch={actions.setNewBatch}
        onStartBatch={actions.handleStartBatch}
        isStopModalOpen={actions.isStopModalOpen}
        setIsStopModalOpen={actions.setIsStopModalOpen}
        isEndingBatch={actions.isEndingBatch}
        activeBatchId={live.activeBatchId}
        onStopBatch={actions.handleStopBatch}
        isHydroModalOpen={actions.isHydroModalOpen}
        setIsHydroModalOpen={actions.setIsHydroModalOpen}
        hydroCheckType={actions.hydroCheckType}
        setHydroCheckType={actions.setHydroCheckType}
        hydroAbvInput={actions.hydroAbvInput}
        setHydroAbvInput={actions.setHydroAbvInput}
        onSaveHydroCheck={actions.handleSaveHydroCheck}
        isSugarModalOpen={actions.isSugarModalOpen}
        setIsSugarModalOpen={actions.setIsSugarModalOpen}
        sugarInput={actions.sugarInput}
        setSugarInput={actions.setSugarInput}
        sugarInstrument={actions.sugarInstrument}
        setSugarInstrument={actions.setSugarInstrument}
        onLogSugarTest={actions.handleLogSugarTest}
      />

    </div>
  );
}
