UPDATE `deployments`
SET `subdomain` = REPLACE(`subdomain`, '.dadiweb.app', '.dadiweb.id')
WHERE `subdomain` LIKE '%.dadiweb.app';
