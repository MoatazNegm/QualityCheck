import React from 'react';
import { APP_VERSION } from '../constants';

const VersionFooter: React.FC = () => {
  return (
    <footer className="version-footer">
      Version {APP_VERSION}
    </footer>
  );
};

export default VersionFooter;
