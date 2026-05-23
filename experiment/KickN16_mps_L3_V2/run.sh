#!/bin/sh

#PBS -l rt_QG=1
#PBS -l walltime=72:00:00
#PBS -j oe
#PBS -W group_list=qgch50090

cd ${PBS_O_WORKDIR}
cd ../..

source /etc/profile.d/modules.sh
module load python/3.13/3.13.11 cuda/12.6 cudnn/9.8
source .venv/bin/activate
python main.py -o experiment/KickN16_mps_L3_V2

deactivate