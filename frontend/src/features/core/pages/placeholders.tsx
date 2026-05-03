import React from 'react';

const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div className="h-full flex items-center justify-center">
    <div className="text-center">
      <h1 className="text-2xl font-black mb-2">{title}</h1>
      <p className="text-white/40 text-sm">This feature is currently under development.</p>
    </div>
  </div>
);

export const OnboardingPage = () => <PlaceholderPage title="Onboarding" />;
export const WorkspacePage = () => <PlaceholderPage title="Workspace Settings" />;
export const ExtensionConnectPage = () => <PlaceholderPage title="Connect Extension" />;
