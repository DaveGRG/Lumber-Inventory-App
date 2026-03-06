import { useAuth } from '../../context/AuthContext';
import { useAppSettings } from '../../context/AppSettingsContext';

// Role-based access gate. When roleRestrictionsEnabled is on in Admin Control,
// this hides children from users whose role is not in allowedRoles.
export function RoleGate({ allowedRoles, children }) {
  const { user } = useAuth();
  const { roleRestrictionsEnabled } = useAppSettings();

  if (!roleRestrictionsEnabled) return children;
  if (!user || !allowedRoles.includes(user.role)) return null;
  return children;
}
