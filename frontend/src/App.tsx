import { BrowserRouter, Route, Routes } from "react-router-dom";
import { TenantProvider } from "./lib/tenant";
import { AppShell } from "./components/layout";
import { ToastProvider } from "./components/toast";
import Dashboard from "./pages/Dashboard";
import { Brands } from "./pages/Brands";
import { BrandDetail } from "./pages/BrandDetail";
import { Threats } from "./pages/Threats";
import { ThreatDetail } from "./pages/ThreatDetail";
import { Entities } from "./pages/Entities";
import { EntityDetail } from "./pages/EntityDetail";
import { NewAnalysis } from "./pages/NewAnalysis";
import { AnalysisJob } from "./pages/AnalysisJob";
import { AnalysisHistory } from "./pages/AnalysisHistory";
import { DiscoveryJob } from "./pages/DiscoveryJob";
import { ScanNew } from "./pages/ScanNew";
import { Scans } from "./pages/Scans";
import { ScanDetail } from "./pages/ScanDetail";
import { Sources } from "./pages/Sources";
import { NotFound } from "./pages/NotFound";
import { Investigation } from "./pages/Investigation";
import { Investigations } from "./pages/Investigations";
import { ThreatGraph } from "./pages/ThreatGraph";
import { DiscoveryCenter } from "./pages/DiscoveryCenter";

export default function App() {
  return (
    <TenantProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppShell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/brands" element={<Brands />} />
              <Route path="/brands/:brandId" element={<BrandDetail />} />
              <Route path="/threats" element={<Threats />} />
              <Route path="/threats/:threatId" element={<ThreatDetail />} />
              <Route path="/entities" element={<Entities />} />
              <Route path="/entities/:entityId" element={<EntityDetail />} />
              <Route path="/analysis/new" element={<NewAnalysis />} />
              <Route path="/analysis/history" element={<AnalysisHistory />} />
              <Route path="/analysis/:jobId" element={<AnalysisJob />} />
              <Route path="/discovery" element={<DiscoveryCenter />} />
              <Route path="/discovery/:jobId" element={<DiscoveryJob />} />
              <Route path="/investigate" element={<Investigations />} />
              <Route path="/investigate/:entityId" element={<Investigation />} />
              <Route path="/graph" element={<ThreatGraph />} />
              <Route path="/scan/new" element={<ScanNew />} />
              <Route path="/scans" element={<Scans />} />
              <Route path="/scans/:scanId" element={<ScanDetail />} />
              <Route path="/sources" element={<Sources />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </ToastProvider>
    </TenantProvider>
  );
}
