import { Outlet, useOutletContext } from 'react-router-dom';
import { AppLayoutContext } from './app-layout';

export default function CampaignLayout() {
  const context = useOutletContext<AppLayoutContext>();

  return (
    <div className="flex h-full w-full overflow-hidden p-3 md:p-4">
      <div className="flex h-full min-w-0 flex-1 overflow-hidden">
        <Outlet context={context} />
      </div>
    </div>
  );
}
