import { Navigate, Route, Routes } from "react-router";

import DashboardPage from "../pages/DashboardPage";
import JourneysPage from "../pages/JourneysPage";
import PagesPage from "../pages/PagesPage";
import PageDetailPage from "../pages/PageDetailPage";
import RealtimePage from "../pages/RealtimePage";
import SearchConsolePage from "../pages/SearchConsolePage";
import ConversionsPage from "../pages/ConversionsPage";
import WebsitesPage from "../pages/WebsitesPage";
import AddWebsitePage from "../pages/AddWebsitePage";
import SiteSetupPage from "../pages/SiteSetupPage";
import SiteSettingsPage from "../pages/SiteSettingsPage";
import BillingPage from "../pages/BillingPage";
import ApiKeysPage from "../pages/ApiKeysPage";
import AccountPage from "../pages/AccountPage";
import LoginPage from "../pages/LoginPage";
import SignupPage from "../pages/SignupPage";
import ForgotPasswordPage from "../pages/ForgotPasswordPage";
import ResetPasswordPage from "../pages/ResetPasswordPage";
import VerifyEmailPage from "../pages/VerifyEmailPage";
import SharedDashboardPage from "../pages/SharedDashboardPage";
import InvitationPage from "../pages/InvitationPage";
import { AuthErrorPage, AuthSuccessPage } from "../pages/AuthCallbackPage";
import ProtectedRoute from "./ProtectedRoute";
import MainLayout from "../shared/layouts/MainLayout";

export default function Router() {
  return (
    <Routes>
      {/* Public share link: no auth, no app shell. */}
      <Route path="/share/:slug" element={<SharedDashboardPage />} />
      {/* Team invitation link: works signed out, explains what to sign in with. */}
      <Route path="/invitations/:token" element={<InvitationPage />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      {/* Google OAuth lands here; the API redirects after setting the cookie. */}
      <Route path="/auth/success" element={<AuthSuccessPage />} />
      <Route path="/auth/error" element={<AuthErrorPage />} />

      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/sites" element={<WebsitesPage />} />
        <Route path="/sites/add" element={<AddWebsitePage />} />
        <Route path="/sites/:domain" element={<DashboardPage />} />
        <Route path="/sites/:domain/pages" element={<PagesPage />} />
        <Route path="/sites/:domain/pages/detail" element={<PageDetailPage />} />
        <Route path="/sites/:domain/journeys" element={<JourneysPage />} />
        <Route path="/sites/:domain/conversions" element={<ConversionsPage />} />
        <Route path="/sites/:domain/search" element={<SearchConsolePage />} />
        <Route path="/sites/:domain/realtime" element={<RealtimePage />} />
        <Route path="/sites/:domain/setup" element={<SiteSetupPage />} />
        <Route path="/sites/:domain/settings" element={<SiteSettingsPage />} />
        <Route path="/settings/billing" element={<BillingPage />} />
        <Route path="/settings/api-keys" element={<ApiKeysPage />} />
        <Route path="/settings/account" element={<AccountPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/sites" replace />} />
      <Route
        path="*"
        element={
          <div className="px-4 py-20 text-center">
            <h1 className="text-lg font-semibold">Page not found</h1>
          </div>
        }
      />
    </Routes>
  );
}
